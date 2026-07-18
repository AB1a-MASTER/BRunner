// content/mapper.js
// BRunner Execution Agent.
// Runs inside target webpages.
// Depends on content/targetResolver.js being loaded first.

(function () {
  const Messages = Object.freeze({
    ExecuteStep: "EXECUTE_STEP",
    PrepareHostFallback: "PREPARE_HOST_FALLBACK",
    VerifyHostFallback: "VERIFY_HOST_FALLBACK",
    ToggleRecording: "TOGGLE_RECORDING",
    GetRecordingState: "GET_RECORDING_STATE",
    SetRecordingState: "SET_RECORDING_STATE",
    RecordedStep: "RECORDED_STEP",
    CancelExecution: "CANCEL_EXECUTION",
    HighlightMapperComponent: "HIGHLIGHT_MAPPER_COMPONENT",
  });

  const Actions = Object.freeze({
    ElementClick: "element.click",
    ElementType: "element.type",
    ElementExtract: "element.extract",
    ElementFocus: "element.focus",
    ElementSelect: "element.select",
    ElementToggle: "element.toggle",
    ElementDoubleClick: "element.double_click",
    ElementHover: "element.hover",
    ElementClear: "element.clear",
    ElementScrollIntoView: "element.scroll_into_view",
    BrowserScroll: "browser.scroll",
    DataExtractText: "data.extract.text",
    DataExtractAttribute: "data.extract.attribute",
    DataExtractList: "data.extract.list",
    DataExtractTable: "data.extract.table",
    DataExtractPage: "data.extract.page",
    FileInputUpload: "file.input.upload",
    LogicWait: "logic.wait",
    WaitElementVisible: "wait.element.visible",
    WaitElementHidden: "wait.element.hidden",
    WaitElementEnabled: "wait.element.enabled",
    WaitElementText: "wait.element.text",
    WaitUrl: "wait.url",
  });

  const resolver = window.BRunnerTargetResolver;
  const filePayload = window.BRunnerFilePayload;
  const DEFAULT_MAPPER_MAX_COMPONENTS = 500;
  const MAX_MAPPER_MAX_COMPONENTS = 2000;
  const MAPPER_SCAN_OVERFLOW_SENTINEL = 1;
  const DEFAULT_MAPPER_MAX_VISITED_NODES = 10000;
  const MAX_MAPPER_MAX_VISITED_NODES = 50000;
  const DEFAULT_MAPPER_MAX_DOM_ROOTS = 256;
  const MAX_MAPPER_PLATFORM_PROFILE_WORK = 128000;
  const MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK = 100000;
  const MAPPER_FACT_WORK_PER_COMPONENT = 128;
  const MIN_MAPPER_FACT_WORK = 2048;
  const MAX_MAPPER_FACT_WORK = 256000;
  const MAX_MAPPER_MUTATION_RECORDS = 100;
  const MAX_MAPPER_MUTATION_NODES = 500;
  const MAX_MAPPER_MUTATION_TEXT_NODES = 1000;
  const MAX_MAPPER_RUNTIME_LOCATORS = 32;
  const DEFAULT_MAPPER_RUNTIME_WORK = 50000;
  const MAX_MAPPER_RUNTIME_WORK = 100000;
  const MAPPER_RESCAN_DEBOUNCE_MS = 350;

  if (!resolver) {
    console.error(
      "[BRunner] targetResolver.js was not loaded before mapper.js.",
    );
    return;
  }

  class BRunnerMapper {
    constructor() {
      this.controls = new Map();
      this.isRecording = false;
      this.recordingSessionId = "";
      this.lastInputValueByElement = new WeakMap();
      this.cancelledRunIds = new Set();
      this.mapperMutationStats = {
        materialMutationCount: 0,
        lastMutationAt: "",
        regionMutationCounts: {},
        observerOverflowCount: 0,
        lastObserverOverflowAt: "",
        lastObserverSummary: null,
      };
      this.mapperObserver = null;
      this.scanTimer = null;
      this.observedMapperRoots = new WeakSet();
      this.currentMapperPlatformProfile = null;
      this.mapperMaxComponents = DEFAULT_MAPPER_MAX_COMPONENTS;
      this.lastMapperScanRoots = [document];
      this.lastMapperTraversalElements = [];
      this.lastMapperScanDiagnostics = {
        version: "mapper.scan.v1",
        maxComponents: this.mapperMaxComponents,
        sampledComponentCount: 0,
        candidateCount: 0,
        candidateCountIsLowerBound: false,
        overflow: false,
      };

      this.scanDom({ reason: "initial" });
      this.installDomObserver();
      this.installMessageListener();
      this.installRecorderListeners();
      this.installRecorderHighlight();
      this.requestRecordingState();

      console.log("[BRunner] Mapper initialized.");
    }

    scanDom(options = {}) {
      if (options.reason !== "material_mutation" && this.scanTimer) {
        window.clearTimeout(this.scanTimer);
        this.scanTimer = null;
      }
      this.controls.clear();
      const maxComponents = this.normalizeMapperMaxComponents(
        options.maxComponents ?? this.mapperMaxComponents,
      );
      this.mapperMaxComponents = maxComponents;
      const maxVisitedNodes = this.normalizeMapperMaxVisitedNodes(
        options.maxVisitedNodes,
      );
      const factWorkBudget = this.createMapperFactWorkBudget({
        maxComponents,
        maxFactWork: options.maxFactWork,
      });

      const enumeration = this.enumerateBoundedStaticCandidateElements({
        maxComponents,
        maxVisitedNodes,
      });
      const elements = enumeration.elements.slice(0, maxComponents);
      this.lastMapperTraversalElements = enumeration.visitedElements || [];
      const platformWorkBudget = this.createMapperWorkBudget(
        options.maxPlatformWork,
        MAX_MAPPER_PLATFORM_PROFILE_WORK,
        MAX_MAPPER_PLATFORM_PROFILE_WORK,
      );
      this.currentMapperPlatformProfile = this.detectMapperPlatformProfile({
        workBudget: platformWorkBudget,
      });

      for (const element of platformWorkBudget.overflow ? [] : elements) {
        const ctrlHash = this.getOrCreateControlHash(element, {
          workBudget: factWorkBudget,
        });
        const targetInfo = resolver.buildElementTarget(element, ctrlHash, {
          workBudget: factWorkBudget,
        });
        if (factWorkBudget.overflow) break;
        const mapperFact = this.buildMapperComponentFact(
          element,
          "",
          targetInfo,
          {
            workBudget: factWorkBudget,
            queryAllowlist: options.queryAllowlist,
          },
        );
        if (factWorkBudget.overflow) break;

        const friendlyName = this.getFriendlyName(element, targetInfo, {
          workBudget: factWorkBudget,
        });
        if (factWorkBudget.overflow) break;

        this.controls.set(ctrlHash, {
          id: ctrlHash,
          element,
          target: targetInfo.primary,
          targetFallbacks: targetInfo.fallbacks,
          snapshot: targetInfo.snapshot,
          mapperFact,
          friendlyName,
        });
      }

      const scanOverflow = enumeration.overflow ||
        platformWorkBudget.overflow ||
        factWorkBudget.overflow;
      const overflowKind = enumeration.overflowKind ||
        (platformWorkBudget.overflow ? "platform_profile_work_budget" : "") ||
        (factWorkBudget.overflow ? "fact_work_budget" : "");

      this.lastMapperScanRoots = enumeration.roots.length
        ? enumeration.roots
        : [document];
      this.lastMapperScanDiagnostics = {
        version: "mapper.scan.v1",
        maxComponents,
        sampledComponentCount: this.controls.size,
        candidateCount: enumeration.candidateCount,
        candidateCountIsLowerBound: scanOverflow,
        overflow: scanOverflow,
        overflowKind,
        candidateLimitExceeded: Boolean(enumeration.candidateLimitExceeded),
        visitedNodeBudgetExceeded: Boolean(enumeration.visitedNodeBudgetExceeded),
        rootBudgetExceeded: Boolean(enumeration.rootBudgetExceeded),
        candidateAssessmentWorkBudgetExceeded: Boolean(
          enumeration.candidateAssessmentWorkBudgetExceeded,
        ),
        candidateAssessmentWorkCount: Number(
          enumeration.candidateAssessmentWorkCount || 0,
        ),
        maxCandidateAssessmentWork: Number(
          enumeration.maxCandidateAssessmentWork || 0,
        ),
        candidateAssessmentWorkOverflowAt:
          enumeration.candidateAssessmentWorkOverflowAt || "",
        discoveredRootCount: Number(enumeration.discoveredRootCount || enumeration.roots.length),
        maxDomRoots: Number(enumeration.maxDomRoots || DEFAULT_MAPPER_MAX_DOM_ROOTS),
        visitedNodeCount: Number(enumeration.visitedNodeCount || 0),
        maxVisitedNodes: Number(enumeration.maxVisitedNodes || maxVisitedNodes),
        factWorkCount: factWorkBudget.workCount,
        maxFactWork: factWorkBudget.maxWork,
        factWorkBudgetExceeded: factWorkBudget.overflow,
        factWorkOverflowAt: factWorkBudget.overflowAt || "",
        platformProfileWorkCount: platformWorkBudget.workCount,
        maxPlatformProfileWork: platformWorkBudget.maxWork,
        platformProfileWorkBudgetExceeded: platformWorkBudget.overflow,
        platformProfileWorkOverflowAt: platformWorkBudget.overflowAt || "",
        rootsVisited: enumeration.roots.length,
        reason: scanOverflow ? "component_scan_overflow" : "",
        trigger: String(options.reason || "scan"),
        mutationObserver: options.mutationDiagnostics || null,
      };

      this.observeMapperRoots(this.lastMapperScanRoots);

      return Array.from(this.controls.values()).map((control) => ({
        id: control.id,
        target: control.target,
        targetFallbacks: control.targetFallbacks,
        snapshot: control.snapshot,
        mapperFact: control.mapperFact,
        friendlyName: control.friendlyName,
      }));
    }

    installDomObserver() {
      this.mapperObserver = new MutationObserver((records = []) => {
        const mutationDiagnostics = this.recordMapperMutations(records);
        if (
          !mutationDiagnostics.materialMutationCount &&
          !mutationDiagnostics.overflow
        ) return;
        window.clearTimeout(this.scanTimer);
        this.scanTimer = window.setTimeout(() => {
          this.scanTimer = null;
          this.scanDom({
            maxComponents: this.mapperMaxComponents,
            reason: "material_mutation",
            mutationDiagnostics,
          });
        }, MAPPER_RESCAN_DEBOUNCE_MS);
      });

      this.observeMapperRoots(this.lastMapperScanRoots);
    }

    observeMapperRoots(roots = this.lastMapperScanRoots) {
      if (!this.mapperObserver) return;
      (Array.isArray(roots) && roots.length ? roots : [document]).forEach((root) => {
        const target = root === document ? document.documentElement : root;
        if (!target || this.observedMapperRoots.has(target)) return;
        this.mapperObserver.observe(target, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: [
            "id",
            "name",
            "aria-label",
            "data-testid",
            "data-test",
            "data-qa",
            "style",
            "class",
            "hidden",
            "disabled",
          ],
        });
        this.observedMapperRoots.add(target);
      });
    }

    recordMapperMutations(records = []) {
      let materialCount = 0;
      let recordsVisited = 0;
      let nodesVisited = 0;
      let textNodesVisited = 0;
      let overflow = false;
      let textWorkOverflow = false;
      const mutationTextBudget = {
        consume: () => {
          if (textNodesVisited >= MAX_MAPPER_MUTATION_TEXT_NODES) {
            textWorkOverflow = true;
            return false;
          }
          textNodesVisited += 1;
          return true;
        },
      };

      for (
        let recordIndex = 0;
        recordIndex < Number(records.length || 0);
        recordIndex += 1
      ) {
        if (recordsVisited >= MAX_MAPPER_MUTATION_RECORDS) {
          overflow = true;
          break;
        }
        const record = records[recordIndex];
        recordsVisited += 1;
        if (this.isBRunnerInternalNode(record.target)) continue;
        let recordMaterialCount = 0;
        if (record.type === "childList") {
          for (const nodes of [record.addedNodes, record.removedNodes]) {
            for (
              let nodeIndex = 0;
              nodeIndex < Number(nodes?.length || 0);
              nodeIndex += 1
            ) {
              if (nodesVisited >= MAX_MAPPER_MUTATION_NODES) {
                overflow = true;
                break;
              }
              nodesVisited += 1;
              if (this.isMaterialMutationNode(nodes[nodeIndex], mutationTextBudget)) {
                recordMaterialCount += 1;
              }
              if (textWorkOverflow) {
                overflow = true;
                break;
              }
            }
            if (overflow) break;
          }
        } else if (record.type === "characterData") {
          if (nodesVisited >= MAX_MAPPER_MUTATION_NODES) {
            overflow = true;
          } else {
            nodesVisited += 1;
            if (record.target?.nodeType === Node.TEXT_NODE) {
              if (!mutationTextBudget.consume()) {
                overflow = true;
              } else {
                // A characterData record proves the text changed. Treat clearing
                // or replacing even short text as material so saved facts cannot
                // remain stale merely because the new value is empty.
                recordMaterialCount = 1;
              }
            }
          }
        } else if (record.type === "attributes") {
          if (nodesVisited >= MAX_MAPPER_MUTATION_NODES) {
            overflow = true;
          } else {
            nodesVisited += 1;
            if (this.isMaterialMutationNode(record.target, mutationTextBudget)) {
              recordMaterialCount = 1;
            }
            if (textWorkOverflow) overflow = true;
          }
        }
        if (recordMaterialCount) {
          materialCount += recordMaterialCount;
          this.recordMapperRegionMutation(record.target, recordMaterialCount);
        }
        if (overflow) break;
      }

      if (Number(records.length || 0) > recordsVisited) overflow = true;
      const now = new Date().toISOString();
      if (materialCount) {
        this.mapperMutationStats.materialMutationCount = Math.min(
          10000,
          this.mapperMutationStats.materialMutationCount + materialCount,
        );
        this.mapperMutationStats.lastMutationAt = now;
      }
      if (overflow) {
        this.mapperMutationStats.observerOverflowCount = Math.min(
          10000,
          this.mapperMutationStats.observerOverflowCount + 1,
        );
        this.mapperMutationStats.lastObserverOverflowAt = now;
      }
      const summary = {
        version: "mapper.mutation_observer.v1",
        materialMutationCount: materialCount,
        recordsVisited,
        maxRecords: MAX_MAPPER_MUTATION_RECORDS,
        nodesVisited,
        maxNodes: MAX_MAPPER_MUTATION_NODES,
        textNodesVisited,
        maxTextNodes: MAX_MAPPER_MUTATION_TEXT_NODES,
        textWorkOverflow,
        overflow,
        reason: overflow
          ? textWorkOverflow
            ? "mutation_observer_text_work_overflow"
            : "mutation_observer_work_overflow"
          : "",
      };
      this.mapperMutationStats.lastObserverSummary = summary;
      return summary;
    }

    recordMapperRegionMutation(node, count = 1) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const regionId = this.getMapperRegionId(element);
      if (!regionId) return;
      const counts = this.mapperMutationStats.regionMutationCounts;
      counts[regionId] = Math.min(10000, (Number(counts[regionId]) || 0) + count);
      const entries = Object.entries(counts);
      if (entries.length <= 100) return;
      entries
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(100)
        .forEach(([key]) => delete counts[key]);
    }

    isMaterialMutationNode(node, textBudget = null) {
      if (!node) return false;
      if (node.nodeType === Node.TEXT_NODE) {
        if (textBudget && !textBudget.consume()) return false;
        return this.cleanMapperText(String(node.nodeValue || "").slice(0, 80)).length >= 2;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (this.isBRunnerInternalNode(node)) return false;
      const element = node;
      if (element.closest?.("#brunner-recorder-highlight, #brunner-mapper-inspector-highlight")) {
        return false;
      }
      if (element.matches?.("script, style, link, meta, title")) return false;
      if (
        element.matches?.(
          "button, a, input, textarea, select, img, svg, canvas, [role], [data-testid], [data-test], [data-qa]",
        ) || Number(element.childElementCount || 0) > 0
      ) return true;

      let directText = "";
      let child = element.firstChild || null;
      for (let index = 0; child && index < 8; index += 1) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (textBudget && !textBudget.consume()) return false;
          directText += ` ${String(child.nodeValue || "").slice(0, 80)}`;
          if (directText.length >= 80) break;
        }
        child = child.nextSibling;
      }
      return this.cleanMapperText(directText).length >= 2;
    }

    isBRunnerInternalNode(node) {
      const element = node?.nodeType === Node.ELEMENT_NODE
        ? node
        : node?.parentElement;
      if (!element) return false;
      return Boolean(
        element.id === "brunner-recorder-highlight" ||
          element.id === "brunner-recorder-highlight-label" ||
          element.id === "brunner-mapper-inspector-highlight" ||
          element.id === "brunner-mapper-inspector-highlight-label" ||
          element.closest?.("#brunner-recorder-highlight, #brunner-mapper-inspector-highlight"),
      );
    }

    getMapperPageSnapshot(options = {}) {
      const context = this.getCurrentPageContext();
      const lifetimeMaterialMutationCount = this.mapperMutationStats.materialMutationCount;
      const platformProfile = this.currentMapperPlatformProfile ||
        this.detectMapperPlatformProfile();
      return {
        url: context.url,
        title: context.title,
        capturedAt: new Date().toISOString(),
        platformProfile,
        materialMutationCount: options.settledCurrentDom
          ? 0
          : lifetimeMaterialMutationCount,
        lifetimeMaterialMutationCount,
        lastMutationAt: this.mapperMutationStats.lastMutationAt,
        mutationObserverDiagnostics: this.mapperMutationStats.lastObserverSummary,
        scanDiagnostics: { ...this.lastMapperScanDiagnostics },
      };
    }

    detectMapperPlatformProfile(options = {}) {
      const workBudget = options.workBudget || this.createMapperWorkBudget(
        undefined,
        MAX_MAPPER_PLATFORM_PROFILE_WORK,
        MAX_MAPPER_PLATFORM_PROFILE_WORK,
      );
      const known = this.detectKnownMapperPlatformProfile();
      const explicitChatRoots = this.countMapperProfileMatches(
        "[data-platform-profile='chat']",
        { workBudget },
      );
      const chatSignals = [
        known.family === "chat" ? 2 : 0,
        explicitChatRoots,
        this.countMapperProfileMatches("[data-testid='conversation-list'], [aria-label*='Conversation' i], [aria-label*='Chat' i]", { workBudget }),
        this.countMapperProfileMatches("[data-testid='active-thread-region'], [aria-label*='thread' i]", { workBudget }),
        this.countMapperProfileMatches("[data-testid='message-composer'], textarea[placeholder*='message' i]", { workBudget }),
        this.countMapperProfileMatches("[data-testid='message-loaded-window'], [data-testid^='message-']", { workBudget }),
      ];
      const explicitSocialRoots = this.countMapperProfileMatches(
        "[data-platform-profile='social']",
        { workBudget },
      );
      const socialSignals = [
        known.family === "social" ? 2 : 0,
        explicitSocialRoots,
        this.countMapperProfileMatches("[data-testid='home-feed-region'], [aria-label*='feed' i]", { workBudget }),
        this.countMapperProfileMatches("[data-testid='social-loaded-window'], [data-testid^='social-card-']", { workBudget }),
        this.countMapperProfileMatches("[data-testid='global-comment-composer'], textarea[placeholder*='comment' i]", { workBudget }),
        this.countMapperProfileMatches("[aria-label*='Post card' i], [aria-label*='actions' i]", { workBudget }),
      ];
      const chatScore = this.platformProfileSignalScore(chatSignals);
      const socialScore = this.platformProfileSignalScore(socialSignals);
      const family = known.family || (chatScore >= 35 && chatScore >= socialScore
        ? "chat"
        : socialScore >= 35
          ? "social"
          : "generic");
      const score = family === "chat" ? chatScore : family === "social" ? socialScore : Math.max(chatScore, socialScore);

      return {
        version: "mapper.platform_profile.v1",
        family,
        confidence: Math.min(Math.max(score, known.family ? 70 : 0), 100),
        product: known.product,
        detectionSource: known.family ? "known_host_plus_landmarks" : "landmarks",
        explicitPlatformRoots: explicitChatRoots + explicitSocialRoots > 0,
        workOverflow: workBudget.overflow,
        workOverflowAt: workBudget.overflowAt || "",
        signals: {
          chat: chatSignals.filter((count) => count > 0).length,
          social: socialSignals.filter((count) => count > 0).length,
        },
        loadedWindowHints: {
          messages: this.countMapperProfileMatches("[data-testid^='message-'][data-thread-id]", { workBudget }),
          feedCards: this.countMapperProfileMatches("[data-testid^='social-card-'][data-loaded-window-index]", { workBudget }),
        },
      };
    }

    detectKnownMapperPlatformProfile() {
      const hostname = String(location.hostname || "").toLowerCase();
      const profiles = [
        { family: "chat", product: "whatsapp", hosts: ["web.whatsapp.com"] },
        { family: "chat", product: "messenger", hosts: ["messenger.com", "www.messenger.com"] },
        { family: "chat", product: "telegram", hosts: ["web.telegram.org"] },
        { family: "chat", product: "slack", hosts: ["app.slack.com"] },
        { family: "chat", product: "discord", hosts: ["discord.com"] },
        { family: "social", product: "facebook", hosts: ["facebook.com", "www.facebook.com"] },
        { family: "social", product: "instagram", hosts: ["instagram.com", "www.instagram.com"] },
        { family: "social", product: "reddit", hosts: ["reddit.com", "www.reddit.com", "old.reddit.com"] },
      ];
      return profiles.find((profile) => profile.hosts.includes(hostname)) || {
        family: "",
        product: "",
      };
    }

    countMapperProfileMatches(selector = "", options = {}) {
      try {
        let count = 0;
        for (const element of this.lastMapperTraversalElements || []) {
          if (options.workBudget && !options.workBudget.consume("platform_profile_match")) {
            break;
          }
          if (!element.matches?.(selector)) continue;
          count += 1;
          if (count >= 999) break;
        }
        return count;
      } catch {
        return 0;
      }
    }

    platformProfileSignalScore(counts = []) {
      const present = counts.filter((count) => count > 0).length;
      const volume = counts.reduce((sum, count) => sum + Math.min(count, 8), 0);
      return Math.min(100, present * 18 + volume);
    }

    installMessageListener() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request)
          .then((response) => sendResponse(response))
          .catch((error) => {
            console.error("[BRunner] Mapper message error:", error);

            sendResponse({
              ok: false,
              error: error.message || String(error),
              diagnostics: error.diagnostics || null,
            });
          });

        return true;
      });
    }

    async handleMessage(request) {
      switch (request?.type) {
        case Messages.ExecuteStep:
          return await this.executeStep(request.step, request.runId || "");

        case Messages.PrepareHostFallback:
          return await this.prepareHostFallback(request.step, request.runId || "");

        case Messages.VerifyHostFallback:
          return await this.verifyHostFallback(request.step, request.runId || "");

        case Messages.CancelExecution:
          if (request.runId) this.cancelledRunIds.add(request.runId);
          return {
            ok: true,
            cancelled: true,
            runId: request.runId || "",
          };

        case Messages.SetRecordingState:
          this.setRecordingState(
            Boolean(request.isRecording),
            request.sessionId,
          );
          return {
            ok: true,
            isRecording: this.isRecording,
            sessionId: this.recordingSessionId,
          };

        case Messages.ToggleRecording:
          this.setRecordingState(Boolean(request.enabled), request.sessionId);
          return {
            ok: true,
            isRecording: this.isRecording,
            sessionId: this.recordingSessionId,
          };

        case Messages.GetRecordingState:
          return {
            ok: true,
            isRecording: this.isRecording,
            sessionId: this.recordingSessionId,
          };

        case Messages.HighlightMapperComponent:
          return this.highlightMapperComponent(
            request.component,
            request.pageMap,
            request.highlightRequestId,
            request.containerTarget,
            request.settings,
            request.actionOverride,
          );

        case "GET_CONTROLS_TREE":
          const controls = this.scanDom({
            maxComponents: request.maxComponents,
            queryAllowlist: request.settings?.queryAllowlist,
            reason: "controls_tree_message",
          });
          return {
            ok: true,
            controls,
            scanDiagnostics: { ...this.lastMapperScanDiagnostics },
            page: this.getMapperPageSnapshot({
              settledCurrentDom: request.snapshotMode === "settled_current_dom",
            }),
            frameScope: this.getMapperFrameScope(),
          };

        default:
          return {
            ok: false,
            error: `Unknown mapper message: ${request?.type || "undefined"}`,
          };
      }
    }

    async requestRecordingState() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: Messages.GetRecordingState,
        });

        const recording = response?.recording;
        this.setRecordingState(
          Boolean(recording?.isRecording),
          recording?.sessionId,
        );
      } catch {
        // Background may not be ready yet. Safe to ignore.
      }
    }

    setRecordingState(enabled, sessionId = "") {
      this.isRecording = enabled;
      this.recordingSessionId = enabled ? String(sessionId || "") : "";

      document.documentElement.dataset.brunnerRecording = enabled
        ? "true"
        : "false";

      if (!enabled) {
        this.hideRecorderHighlight();
      }

      console.log(`[BRunner] Recording ${enabled ? "enabled" : "disabled"}.`);
    }

    installRecorderListeners() {
      document.addEventListener(
        "click",
        (event) => this.recordClick(event),
        true,
      );

      document.addEventListener(
        "change",
        (event) => this.recordInputLikeEvent(event),
        true,
      );

      document.addEventListener(
        "blur",
        (event) => this.recordInputLikeEvent(event),
        true,
      );

      document.addEventListener(
        "keydown",
        (event) => {
          if (!this.isRecording) return;

          const element = event.target;
          if (!this.isTextEntryElement(element)) return;

          this.lastInputValueByElement.set(element, element.value || "");
        },
        true,
      );
    }

    installRecorderHighlight() {
      this.highlightBox = document.createElement("div");
      this.highlightBox.id = "brunner-recorder-highlight";

      Object.assign(this.highlightBox.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: "2px solid #3b82f6",
        background: "rgba(59, 130, 246, 0.12)",
        borderRadius: "6px",
        boxShadow: "0 0 0 2px rgba(59, 130, 246, 0.25)",
        display: "none",
        transition: "all 80ms ease",
      });

      this.highlightLabel = document.createElement("div");
      this.highlightLabel.id = "brunner-recorder-highlight-label";

      Object.assign(this.highlightLabel.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        background: "#1d4ed8",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        fontWeight: "600",
        padding: "3px 6px",
        borderRadius: "4px",
        display: "none",
        maxWidth: "300px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });

      document.documentElement.appendChild(this.highlightBox);
      document.documentElement.appendChild(this.highlightLabel);

      this.mapperHighlightBox = document.createElement("div");
      this.mapperHighlightBox.id = "brunner-mapper-inspector-highlight";
      Object.assign(this.mapperHighlightBox.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: "2px solid #22c55e",
        background: "rgba(34, 197, 94, 0.14)",
        borderRadius: "4px",
        boxShadow: "0 0 0 2px rgba(34, 197, 94, 0.24)",
        display: "none",
      });

      this.mapperHighlightLabel = document.createElement("div");
      this.mapperHighlightLabel.id = "brunner-mapper-inspector-highlight-label";
      Object.assign(this.mapperHighlightLabel.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        background: "#166534",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        fontWeight: "650",
        padding: "4px 7px",
        borderRadius: "4px",
        display: "none",
        maxWidth: "360px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });

      document.documentElement.appendChild(this.mapperHighlightBox);
      document.documentElement.appendChild(this.mapperHighlightLabel);

      document.addEventListener(
        "mouseover",
        (event) => {
          if (!this.isRecording) return;

          const element = this.findRecordableElement(event.target);
          if (!element) {
            this.hideRecorderHighlight();
            return;
          }

          this.showRecorderHighlight(element);
        },
        true,
      );

      document.addEventListener(
        "mouseout",
        (event) => {
          if (!this.isRecording) return;

          const nextTarget = event.relatedTarget;

          if (
            nextTarget &&
            nextTarget instanceof Element &&
            this.findRecordableElement(nextTarget)
          ) {
            return;
          }

          this.hideRecorderHighlight();
        },
        true,
      );

      window.addEventListener(
        "scroll",
        () => {
          if (this.highlightedElement && this.isRecording) {
            this.showRecorderHighlight(this.highlightedElement);
          }
          if (this.mapperHighlightedElement) {
            this.refreshMapperInspectorHighlight();
          }
        },
        true,
      );

      window.addEventListener("resize", () => {
        if (this.highlightedElement && this.isRecording) {
          this.showRecorderHighlight(this.highlightedElement);
        }
        if (this.mapperHighlightedElement) {
          this.refreshMapperInspectorHighlight();
        }
      });
    }

    async highlightMapperComponent(
      component = {},
      pageMap = {},
      highlightRequestId = 0,
      containerTarget = null,
      settings = {},
      actionOverride = "",
    ) {
      const requestId = Number(highlightRequestId) || 0;
      if (requestId && requestId < (this.mapperHighlightRequestId || 0)) {
        return {
          ok: true,
          mapperState: "stale",
          mapperReason: "stale_highlight_request",
          confidence: 0,
          attempts: [],
          resolverLog: null,
          highlighted: false,
        };
      }
      if (requestId) this.mapperHighlightRequestId = requestId;

      if (!this.mapperPageMatchesCurrentLocation(pageMap, settings)) {
        this.hideMapperInspectorHighlight();
        return {
          ok: true,
          mapperState: "map_stale",
          mapperReason: "page_profile_mismatch",
          confidence: 0,
          attempts: [],
          resolverLog: null,
          highlighted: false,
        };
      }

      if (containerTarget?.domPath) {
        return await this.highlightMapperContainer(containerTarget, requestId, pageMap);
      }

      if (!component?.componentId) {
        this.hideMapperInspectorHighlight();
        return {
          ok: true,
          mapperState: "cleared",
          mapperReason: "inspector_highlight_cleared",
          confidence: 0,
          attempts: [],
          resolverLog: null,
          highlighted: false,
        };
      }

      const result = this.resolveMapperComponentTarget({
        mapperContext: {
          state: "ready",
          includeHidden: true,
          pageMap: {
            classification: pageMap?.classification || "",
          },
          component,
        },
      }, Object.values(Actions).includes(actionOverride) ? actionOverride : component.action || "");

      const hidden = Boolean(result.element && !this.isVisibleElement(result.element));
      let highlighted = false;
      if (result.element && !hidden) {
        highlighted = await this.showMapperInspectorHighlight(
          result.element,
          component,
          result.mapperState || "resolved",
          requestId,
        );
      } else {
        this.hideMapperInspectorHighlight();
      }

      if (requestId && requestId !== this.mapperHighlightRequestId) {
        return {
          ok: true,
          mapperState: "stale",
          mapperReason: "stale_highlight_request",
          confidence: 0,
          attempts: [],
          resolverLog: null,
          highlighted: false,
        };
      }

      const resolverLog = hidden && result.resolverLog
        ? {
            ...result.resolverLog,
            state: "hidden",
            reason: "resolved_element_hidden",
          }
        : result.resolverLog || null;

      return {
        ok: true,
        mapperState: hidden ? "hidden" : result.mapperState || "not_found",
        mapperReason: hidden ? "resolved_element_hidden" : result.mapperReason || "",
        confidence: result.confidence || 0,
        attempts: result.attempts || [],
        resolverLog,
        highlighted,
        hidden,
      };
    }

    async highlightMapperContainer(target = {}, requestId = 0, pageMap = {}) {
      const anchoredElement = this.resolveMapperContainerAnchor(target, pageMap);
      const enumeration = anchoredElement
        ? { elements: [anchoredElement], overflow: false }
        : this.findMapperElementsByDomPath(target.domPath);
      if (enumeration.overflow) {
        this.hideMapperInspectorHighlight();
        return {
          ok: true,
          mapperState: "protected_unsupported",
          mapperReason: "component_scan_overflow",
          confidence: 0,
          attempts: [],
          resolverLog: null,
          highlighted: false,
          hidden: false,
          scanDiagnostics: enumeration,
        };
      }
      const matches = enumeration.elements;
      if (matches.length !== 1) {
        this.hideMapperInspectorHighlight();
        return {
          ok: true,
          mapperState: matches.length ? "ambiguous" : "not_found",
          mapperReason: matches.length ? "container_path_ambiguous" : "container_path_not_found",
          confidence: 0,
          attempts: [],
          resolverLog: null,
          highlighted: false,
          hidden: false,
        };
      }

      const element = matches[0];
      const hidden = !this.isVisibleElement(element);
      const component = {
        componentId: target.label || "container",
        status: "container",
      };
      const highlighted = hidden
        ? false
        : await this.showMapperInspectorHighlight(
            element,
            component,
            "container",
            requestId,
          );
      if (hidden) this.hideMapperInspectorHighlight();
      if (requestId && requestId !== this.mapperHighlightRequestId) {
        return {
          ok: true,
          mapperState: "stale",
          mapperReason: "stale_highlight_request",
          confidence: 0,
          attempts: [],
          resolverLog: null,
          highlighted: false,
          hidden: false,
        };
      }
      return {
        ok: true,
        mapperState: hidden ? "hidden" : "resolved",
        mapperReason: hidden
          ? "container_hidden"
          : anchoredElement
            ? "container_anchor_resolved"
            : "container_path_unique",
        confidence: 100,
        attempts: [],
        resolverLog: null,
        highlighted,
        hidden,
      };
    }

    resolveMapperContainerAnchor(target = {}, pageMap = {}) {
      const componentId = String(target.anchorComponentId || "");
      if (!componentId) return null;
      const component = (pageMap.components || []).find((item) => item.componentId === componentId);
      if (!component) return null;
      const result = this.resolveMapperComponentTarget({
        mapperContext: {
          state: "ready",
          includeHidden: true,
          pageMap: {
            classification: pageMap.classification || "",
          },
          component,
        },
      }, component.action || "");
      let element = result.element || null;
      const ancestorDepth = Math.min(40, Math.max(0, Number(target.ancestorDepth) || 0));
      for (let depth = 0; element && depth < ancestorDepth; depth += 1) {
        element = this.getMapperComposedParentElement(element);
      }
      return element instanceof Element ? element : null;
    }

    getMapperComposedParentElement(element = null) {
      if (!element) return null;
      if (element.parentElement) return element.parentElement;
      const root = element.getRootNode?.();
      return root instanceof ShadowRoot ? root.host : null;
    }

    async showMapperInspectorHighlight(element, component = {}, state = "resolved", highlightRequestId = 0) {
      if (!element || !this.isVisibleElement(element)) {
        this.hideMapperInspectorHighlight();
        return false;
      }

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await this.afterNextPaint();
      if (highlightRequestId && highlightRequestId !== this.mapperHighlightRequestId) {
        return false;
      }

      this.mapperHighlightedElement = element;
      this.mapperHighlightedComponent = component;
      this.mapperHighlightedState = state;
      this.hideRecorderHighlight();

      const rect = element.getBoundingClientRect();
      this.drawMapperInspectorHighlight(rect, component, state);
      return true;
    }

    refreshMapperInspectorHighlight() {
      const element = this.mapperHighlightedElement;
      if (!element || !this.isVisibleElement(element)) {
        this.hideMapperInspectorHighlight();
        return;
      }

      this.drawMapperInspectorHighlight(
        element.getBoundingClientRect(),
        this.mapperHighlightedComponent || {},
        this.mapperHighlightedState || "resolved",
      );
    }

    drawMapperInspectorHighlight(rect = {}, component = {}, state = "resolved") {
      const color = this.mapperHighlightColor(state, component.status);
      const labelTop = Math.max(0, Number(rect.top ?? rect.y) - 26);
      const left = Math.max(0, Number(rect.left ?? rect.x) || 0);
      const top = Math.max(0, Number(rect.top ?? rect.y) || 0);
      const width = Math.max(4, Number(rect.width) || 4);
      const height = Math.max(4, Number(rect.height) || 4);

      Object.assign(this.mapperHighlightBox.style, {
        display: "block",
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${Math.round(width)}px`,
        height: `${Math.round(height)}px`,
        borderColor: color.border,
        background: color.background,
        boxShadow: `0 0 0 2px ${color.shadow}`,
      });

      this.mapperHighlightLabel.textContent = `${component.componentId || "component"}: ${state}`;
      Object.assign(this.mapperHighlightLabel.style, {
        display: "block",
        left: `${Math.round(left)}px`,
        top: `${Math.round(labelTop)}px`,
        background: color.label,
      });
    }

    hideMapperInspectorHighlight() {
      this.mapperHighlightedElement = null;
      this.mapperHighlightedComponent = null;
      this.mapperHighlightedState = "";

      if (this.mapperHighlightBox) {
        this.mapperHighlightBox.style.display = "none";
      }
      if (this.mapperHighlightLabel) {
        this.mapperHighlightLabel.style.display = "none";
      }
    }

    afterNextPaint() {
      return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      });
    }

    mapperHighlightColor(state = "", status = "") {
      const key = state || status || "";
      if (key.includes("ambiguous")) {
        return {
          border: "#f59e0b",
          background: "rgba(245, 158, 11, 0.16)",
          shadow: "rgba(245, 158, 11, 0.28)",
          label: "#92400e",
        };
      }
      if (key.includes("not_found") || status === "removed") {
        return {
          border: "#ef4444",
          background: "rgba(239, 68, 68, 0.14)",
          shadow: "rgba(239, 68, 68, 0.26)",
          label: "#991b1b",
        };
      }
      if (key.includes("dynamic") || key.includes("unsupported")) {
        return {
          border: "#8b5cf6",
          background: "rgba(139, 92, 246, 0.14)",
          shadow: "rgba(139, 92, 246, 0.24)",
          label: "#5b21b6",
        };
      }
      if (key.includes("fallback") || status === "changed") {
        return {
          border: "#06b6d4",
          background: "rgba(6, 182, 212, 0.14)",
          shadow: "rgba(6, 182, 212, 0.24)",
          label: "#155e75",
        };
      }
      return {
        border: "#22c55e",
        background: "rgba(34, 197, 94, 0.14)",
        shadow: "rgba(34, 197, 94, 0.24)",
        label: "#166534",
      };
    }

    showRecorderHighlight(element) {
      if (!element || !this.isVisibleElement(element)) {
        this.hideRecorderHighlight();
        return;
      }

      this.highlightedElement = element;

      const rect = element.getBoundingClientRect();
      const ctrlHash = this.getOrCreateControlHash(element);
      const targetInfo = resolver.buildElementTarget(element, ctrlHash);
      const friendlyName = this.getFriendlyName(element, targetInfo);

      Object.assign(this.highlightBox.style, {
        display: "block",
        left: `${Math.round(rect.left)}px`,
        top: `${Math.round(rect.top)}px`,
        width: `${Math.round(rect.width)}px`,
        height: `${Math.round(rect.height)}px`,
      });

      const labelTop = Math.max(0, rect.top - 24);

      this.highlightLabel.textContent = `BRunner: ${friendlyName}`;

      Object.assign(this.highlightLabel.style, {
        display: "block",
        left: `${Math.round(rect.left)}px`,
        top: `${Math.round(labelTop)}px`,
      });
    }

    hideRecorderHighlight() {
      this.highlightedElement = null;

      if (this.highlightBox) {
        this.highlightBox.style.display = "none";
      }

      if (this.highlightLabel) {
        this.highlightLabel.style.display = "none";
      }
    }

    recordClick(event) {
      if (!this.isRecording) return;

      const element = this.findRecordableElementFromEvent(event);
      if (!element) return;

      // Avoid recording clicks generated by BRunner itself.
      if (element.dataset?.brunnerSuppressRecord === "true") return;

      const step = this.createRecordedStep(Actions.ElementClick, element);

      this.emitRecordedStep(step);
    }

    recordInputLikeEvent(event) {
      if (!this.isRecording) return;

      const element = event.target;
      if (!this.isTextEntryElement(element)) return;

      const value = this.getElementValue(element);
      const previous = this.lastInputValueByElement.get(element);

      if (previous === value) return;

      this.lastInputValueByElement.set(element, value);

      const step = element.tagName?.toLowerCase?.() === "select"
        ? this.createRecordedStep(Actions.ElementSelect, element, {
            value: this.getSelectedOptionText(element) || value,
            optionText: this.getSelectedOptionText(element),
            optionValue: value,
            optionIndex: Number(element.selectedIndex),
          })
        : this.createRecordedStep(Actions.ElementType, element, {
            value,
          });

      this.emitRecordedStep(step);
    }

    createRecordedStep(action, element, extra = {}) {
      const ctrlHash = this.getOrCreateControlHash(element);
      const targetInfo = resolver.buildElementTarget(element, ctrlHash);
      const friendlyName = this.getFriendlyName(element, targetInfo);
      const mapperFact = this.buildMapperComponentFact(
        element,
        action,
        targetInfo,
      );
      const componentRef = this.createComponentRef(mapperFact);

      return {
        action,
        componentRef,
        mapperFact,
        target: {
          primary: targetInfo.primary,
          candidates:
            targetInfo.candidates ||
            [targetInfo.primary, ...(targetInfo.fallbacks || [])].filter(
              Boolean,
            ),
          fallbacks: targetInfo.fallbacks || [],
          snapshot: targetInfo.snapshot,
        },
        targetType: targetInfo.primary?.strategy || "",
        targetFallbacks: targetInfo.fallbacks || [],
        targetSnapshot: targetInfo.snapshot,
        friendlyName,
        page: this.getCurrentPageContext(),
        recordedAt: new Date().toISOString(),
        ...extra,
      };
    }

    emitRecordedStep(step) {
      chrome.runtime
        .sendMessage({
          type: Messages.RecordedStep,
          sessionId: this.recordingSessionId,
          step,
        })
        .catch((error) => {
          console.warn("[BRunner] Failed to emit recorded step:", error);
        });
    }

    enumerateBoundedStaticCandidateElements(options = {}) {
      const selector = this.getMapperStaticCandidateSelector();
      const maxComponents = this.normalizeMapperMaxComponents(options.maxComponents);
      const sentinelLimit = maxComponents + MAPPER_SCAN_OVERFLOW_SENTINEL;
      const maxVisitedNodes = this.normalizeMapperMaxVisitedNodes(
        options.maxVisitedNodes,
      );
      const visitedNodeLimit = maxVisitedNodes + MAPPER_SCAN_OVERFLOW_SENTINEL;
      const maxDomRoots = DEFAULT_MAPPER_MAX_DOM_ROOTS;
      const candidateWorkBudget = this.createMapperWorkBudget(
        options.maxCandidateWork,
        Math.min(MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK, maxVisitedNodes * 4),
        MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK,
      );
      const elements = [];
      const visitedElements = [];
      const roots = [];
      const pendingRoots = [document];
      let pendingRootIndex = 0;
      const seenRoots = new Set(pendingRoots);
      const seenElements = new Set();
      let rootBudgetExceeded = false;

      while (
        pendingRootIndex < pendingRoots.length &&
        elements.length < sentinelLimit &&
        visitedElements.length < visitedNodeLimit &&
        !rootBudgetExceeded
      ) {
        const root = pendingRoots[pendingRootIndex];
        pendingRootIndex += 1;
        roots.push(root);
        const ownerDocument = root.ownerDocument || document;
        const walker = ownerDocument.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT,
        );
        let element = walker.nextNode();
        while (
          element &&
          elements.length < sentinelLimit &&
          visitedElements.length < visitedNodeLimit
        ) {
          visitedElements.push(element);
          if (element.shadowRoot && !seenRoots.has(element.shadowRoot)) {
            if (seenRoots.size >= maxDomRoots) {
              rootBudgetExceeded = true;
              break;
            }
            seenRoots.add(element.shadowRoot);
            pendingRoots.push(element.shadowRoot);
          }
          if (
            element.matches?.(selector) &&
            !seenElements.has(element) &&
            (options.includeHidden || this.isUsableControl(element, {
              workBudget: candidateWorkBudget,
            }))
          ) {
            seenElements.add(element);
            elements.push(element);
          }
          if (candidateWorkBudget.overflow) break;
          element = walker.nextNode();
        }
        if (candidateWorkBudget.overflow) break;
      }

      elements.sort((a, b) => this.compareElementsByVisualOrder(a, b));
      const candidateLimitExceeded = elements.length > maxComponents;
      const visitedNodeBudgetExceeded = visitedElements.length > maxVisitedNodes;
      const overflow = candidateLimitExceeded ||
        visitedNodeBudgetExceeded ||
        rootBudgetExceeded ||
        candidateWorkBudget.overflow;
      return {
        elements,
        visitedElements,
        roots,
        overflow,
        overflowKind: candidateLimitExceeded
          ? "component_limit"
          : visitedNodeBudgetExceeded
            ? "visited_node_budget"
            : rootBudgetExceeded
              ? "dom_root_budget"
              : candidateWorkBudget.overflow
                ? "candidate_assessment_work_budget"
                : "",
        candidateLimitExceeded,
        visitedNodeBudgetExceeded,
        rootBudgetExceeded,
        candidateAssessmentWorkBudgetExceeded: candidateWorkBudget.overflow,
        candidateAssessmentWorkCount: candidateWorkBudget.workCount,
        maxCandidateAssessmentWork: candidateWorkBudget.maxWork,
        candidateAssessmentWorkOverflowAt: candidateWorkBudget.overflowAt || "",
        discoveredRootCount: rootBudgetExceeded ? maxDomRoots + 1 : seenRoots.size,
        maxDomRoots,
        candidateCount: candidateLimitExceeded ? sentinelLimit : elements.length,
        maxComponents,
        visitedNodeCount: visitedElements.length,
        maxVisitedNodes,
      };
    }

    enumerateStaticCandidateElements(options = {}) {
      return this.enumerateBoundedStaticCandidateElements(options);
    }

    enumerateBoundedMapperElements(options = {}) {
      const maxComponents = this.normalizeMapperMaxComponents(options.maxComponents);
      const sentinelLimit = maxComponents + MAPPER_SCAN_OVERFLOW_SENTINEL;
      const maxVisitedNodes = this.normalizeMapperMaxVisitedNodes(
        options.maxVisitedNodes,
      );
      const visitedNodeLimit = maxVisitedNodes + MAPPER_SCAN_OVERFLOW_SENTINEL;
      const maxDomRoots = DEFAULT_MAPPER_MAX_DOM_ROOTS;
      const elements = [];
      const visitedElements = [];
      const roots = [];
      const pendingRoots = [document];
      let pendingRootIndex = 0;
      const seenRoots = new Set(pendingRoots);
      const seenElements = new Set();
      const workBudget = options.workBudget || null;
      const candidateWorkBudget = options.candidateWorkBudget || workBudget ||
        this.createMapperWorkBudget(
          options.maxCandidateWork,
          Math.min(MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK, maxVisitedNodes * 4),
          MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK,
        );
      let rootBudgetExceeded = false;
      let externalWorkBudgetExceeded = false;
      const matches = typeof options.matches === "function"
        ? options.matches
        : () => false;

      while (
        pendingRootIndex < pendingRoots.length &&
        elements.length < sentinelLimit &&
        visitedElements.length < visitedNodeLimit &&
        !rootBudgetExceeded &&
        !externalWorkBudgetExceeded
      ) {
        const root = pendingRoots[pendingRootIndex];
        pendingRootIndex += 1;
        roots.push(root);
        const ownerDocument = root.ownerDocument || document;
        const walker = ownerDocument.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT,
        );
        let element = walker.nextNode();
        while (
          element &&
          elements.length < sentinelLimit &&
          visitedElements.length < visitedNodeLimit
        ) {
          if (workBudget && !workBudget.consume("runtime_dom_visit")) {
            externalWorkBudgetExceeded = true;
            break;
          }
          visitedElements.push(element);
          if (element.shadowRoot && !seenRoots.has(element.shadowRoot)) {
            if (seenRoots.size >= maxDomRoots) {
              rootBudgetExceeded = true;
              break;
            }
            seenRoots.add(element.shadowRoot);
            pendingRoots.push(element.shadowRoot);
          }
          if (
            !seenElements.has(element) &&
            matches(element) &&
            (options.includeHidden || this.isUsableControl(element, {
              workBudget: candidateWorkBudget,
            }))
          ) {
            seenElements.add(element);
            elements.push(element);
          }
          if (candidateWorkBudget.overflow) {
            externalWorkBudgetExceeded = true;
            break;
          }
          element = walker.nextNode();
        }
      }

      elements.sort((a, b) => this.compareElementsByVisualOrder(a, b));
      const candidateLimitExceeded = elements.length > maxComponents;
      const visitedNodeBudgetExceeded = visitedElements.length > maxVisitedNodes;
      const overflow = candidateLimitExceeded ||
        visitedNodeBudgetExceeded ||
        rootBudgetExceeded ||
        externalWorkBudgetExceeded;
      return {
        elements,
        visitedElements,
        roots,
        overflow,
        overflowKind: candidateLimitExceeded
          ? "component_limit"
          : visitedNodeBudgetExceeded
            ? "visited_node_budget"
            : rootBudgetExceeded
              ? "dom_root_budget"
              : externalWorkBudgetExceeded
                ? "runtime_work_budget"
                : "",
        candidateLimitExceeded,
        visitedNodeBudgetExceeded,
        rootBudgetExceeded,
        externalWorkBudgetExceeded,
        candidateAssessmentWorkBudgetExceeded: candidateWorkBudget.overflow,
        discoveredRootCount: rootBudgetExceeded ? maxDomRoots + 1 : seenRoots.size,
        maxDomRoots,
        workCount: Number(workBudget?.workCount || 0),
        maxWork: Number(workBudget?.maxWork || 0),
        overflowAt: String(workBudget?.overflowAt || ""),
        candidateCount: candidateLimitExceeded ? sentinelLimit : elements.length,
        maxComponents,
        visitedNodeCount: visitedElements.length,
        maxVisitedNodes,
      };
    }

    getMapperStaticCandidateSelector() {
      return [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "img",
        "picture",
        "svg",
        "canvas",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "label",
        "li",
        "td",
        "th",
        "span",
        "pre",
        "output",
        "[role='button']",
        "[role='link']",
        "[role='textbox']",
        "[role='img']",
        "[role='heading']",
        "[role='status']",
        "[role='log']",
        "[contenteditable='true']",
      ].join(",");
    }

    normalizeMapperMaxComponents(value) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) return DEFAULT_MAPPER_MAX_COMPONENTS;
      return Math.min(
        MAX_MAPPER_MAX_COMPONENTS,
        Math.max(1, parsed),
      );
    }

    normalizeMapperMaxVisitedNodes(value) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) return DEFAULT_MAPPER_MAX_VISITED_NODES;
      return Math.min(
        MAX_MAPPER_MAX_VISITED_NODES,
        Math.max(1, parsed),
      );
    }

    normalizeMapperMaxFactWork(value, maxComponents = this.mapperMaxComponents) {
      const parsed = Number(value);
      if (Number.isInteger(parsed)) {
        return Math.min(MAX_MAPPER_FACT_WORK, Math.max(1, parsed));
      }
      return Math.min(
        MAX_MAPPER_FACT_WORK,
        Math.max(
          MIN_MAPPER_FACT_WORK,
          this.normalizeMapperMaxComponents(maxComponents) *
            MAPPER_FACT_WORK_PER_COMPONENT,
        ),
      );
    }

    createMapperFactWorkBudget(options = {}) {
      const maxWork = this.normalizeMapperMaxFactWork(
        options.maxFactWork,
        options.maxComponents,
      );
      const budget = {
        maxWork,
        workCount: 0,
        overflow: false,
        overflowAt: "",
        consume(kind = "fact_work", count = 1) {
          if (budget.overflow) return false;
          const amount = Math.max(1, Number(count) || 1);
          if (budget.workCount + amount > budget.maxWork) {
            budget.overflow = true;
            budget.overflowAt = String(kind || "fact_work");
            return false;
          }
          budget.workCount += amount;
          return true;
        },
        fail(kind = "fact_work") {
          budget.overflow = true;
          budget.overflowAt ||= String(kind || "fact_work");
          return false;
        },
      };
      return budget;
    }

    createMapperWorkBudget(value, defaultValue, maximumValue) {
      const parsed = Number(value);
      const fallback = Math.max(1, Number(defaultValue) || 1);
      const maximum = Math.max(fallback, Number(maximumValue) || fallback);
      const maxWork = Number.isInteger(parsed)
        ? Math.min(maximum, Math.max(1, parsed))
        : fallback;
      const budget = {
        maxWork,
        workCount: 0,
        overflow: false,
        overflowAt: "",
        consume(kind = "mapper_work", count = 1) {
          if (budget.overflow) return false;
          const amount = Math.max(1, Number(count) || 1);
          if (budget.workCount + amount > budget.maxWork) {
            budget.overflow = true;
            budget.overflowAt = String(kind || "mapper_work");
            return false;
          }
          budget.workCount += amount;
          return true;
        },
        fail(kind = "mapper_work") {
          budget.overflow = true;
          budget.overflowAt ||= String(kind || "mapper_work");
          return false;
        },
      };
      return budget;
    }

    consumeMapperFactWork(kind = "fact_work", count = 1) {
      const budget = this.activeMapperFactWorkBudget;
      return !budget || budget.consume(kind, count);
    }

    failMapperFactWork(kind = "fact_work") {
      const budget = this.activeMapperFactWorkBudget;
      if (!budget) return false;
      if (typeof budget.fail === "function") return budget.fail(kind);
      budget.overflow = true;
      budget.overflowAt ||= String(kind || "fact_work");
      return false;
    }

    withMapperFactWorkBudget(workBudget, callback) {
      const previousBudget = this.activeMapperFactWorkBudget || null;
      this.activeMapperFactWorkBudget = workBudget || previousBudget;
      try {
        return callback();
      } finally {
        this.activeMapperFactWorkBudget = previousBudget;
      }
    }

    getBoundedMapperClosest(element, selector, kind = "fact_ancestor") {
      if (!element || !selector) return null;
      let current = element;
      while (current) {
        if (!this.consumeMapperFactWork(kind)) return null;
        try {
          if (current.matches?.(selector)) return current;
        } catch {
          return null;
        }
        current = this.getMapperComposedParentElement(current);
      }
      return null;
    }

    getBoundedMapperSiblingIndex(element, kind = "fact_sibling") {
      const parent = element?.parentElement;
      if (!parent) return 0;
      let index = 0;
      let current = parent.firstElementChild;
      while (current) {
        if (!this.consumeMapperFactWork(kind)) return -1;
        if (current === element) return index;
        index += 1;
        current = current.nextElementSibling;
      }
      return -1;
    }

    getBoundedMapperClassTokens(element, maxTokens = 8) {
      const tokens = [];
      const classes = element?.classList || [];
      for (let index = 0; index < Number(classes.length || 0); index += 1) {
        if (!this.consumeMapperFactWork("fact_class_token")) return [];
        const token = this.toMapperIdentifier(classes[index]);
        if (token) tokens.push(token);
        if (tokens.length >= maxTokens) break;
      }
      return tokens;
    }

    findBoundedMapperDescendant(root, selector, kind = "fact_descendant") {
      if (!root || !selector) return null;
      let walker;
      try {
        const ownerDocument = root.ownerDocument || document;
        walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      } catch {
        return null;
      }
      let element = walker.nextNode();
      while (element) {
        if (!this.consumeMapperFactWork(kind)) return null;
        try {
          if (element.matches?.(selector)) return element;
        } catch {
          return null;
        }
        element = walker.nextNode();
      }
      return null;
    }

    compareElementsByVisualOrder(a, b) {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const aTop = aRect.top + (window.scrollY || window.pageYOffset || 0);
      const bTop = bRect.top + (window.scrollY || window.pageYOffset || 0);
      const topDelta = aTop - bTop;
      if (Math.abs(topDelta) > 4) return topDelta;

      const aLeft = aRect.left + (window.scrollX || window.pageXOffset || 0);
      const bLeft = bRect.left + (window.scrollX || window.pageXOffset || 0);
      const leftDelta = aLeft - bLeft;
      if (Math.abs(leftDelta) > 4) return leftDelta;

      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    }

    getOpenDomRoots(options = {}) {
      const enumeration = this.enumerateBoundedMapperElements({
        maxComponents: 1,
        maxVisitedNodes: options.maxVisitedNodes,
        includeHidden: true,
        matches: () => false,
        workBudget: options.workBudget,
      });
      return {
        roots: enumeration.roots,
        overflow: enumeration.overflow,
        overflowKind: enumeration.overflowKind,
        visitedNodeCount: enumeration.visitedNodeCount,
        maxVisitedNodes: enumeration.maxVisitedNodes,
      };
    }

    findRecordableElementFromEvent(event) {
      const path = typeof event?.composedPath === "function"
        ? event.composedPath()
        : [];

      for (const candidate of path) {
        const element = this.findRecordableElement(candidate);
        if (element) return element;
      }

      return this.findRecordableElement(event?.target);
    }

    buildMapperComponentFact(element, action = "", targetInfo = {}, options = {}) {
      const previousBudget = this.activeMapperFactWorkBudget || null;
      this.activeMapperFactWorkBudget = options.workBudget || previousBudget;
      try {
      const snapshot = targetInfo.snapshot || {};
      const page = this.getCurrentPageContext();
      const pageProfile = this.mapperPageProfile(page, {
        queryAllowlist: options.queryAllowlist,
      });
      const siteKey = pageProfile.siteKey;
      const pageName = pageProfile.pageName;
      const pageProfileKey = pageProfile.pageProfileKey;
      const structural = this.buildMapperStructuralFacts(element, snapshot);
      const semantic = this.buildMapperSemanticFacts(
        element,
        snapshot,
        structural.platformScope,
      );
      const technical = this.buildMapperTechnicalFacts(element, snapshot);
      const behavioral = this.buildMapperBehavioralFacts(element, action, snapshot);
      const visual = {
        bounds: snapshot.bounds || this.getViewportBounds(element),
        viewportBounds: snapshot.bounds || this.getViewportBounds(element),
        documentBounds: this.getDocumentBounds(element),
        viewport: {
          width: Math.round(window.innerWidth || 0),
          height: Math.round(window.innerHeight || 0),
          scrollX: Math.round(window.scrollX || window.pageXOffset || 0),
          scrollY: Math.round(window.scrollY || window.pageYOffset || 0),
        },
      };
      const locatorCandidates = (targetInfo.candidates || [
        targetInfo.primary,
        ...(targetInfo.fallbacks || []),
      ])
        .filter(Boolean)
        .map((locator) => ({
          strategy: locator.strategy || "",
          value: locator.value || "",
          reliability: Number(locator.score || locator.reliability || 50),
          selectedAtCapture: locator === targetInfo.primary,
        }));
      const componentSeed = this.mapperComponentSeed(semantic, technical);
      const componentContext = structural.ancestorTokens
        .map((token) => this.toMapperIdentifier(token))
        .filter(Boolean)
        .slice(0, 1)
        .join("_");
      const componentId = [
        siteKey,
        pageName,
        componentContext,
        componentSeed,
      ].filter(Boolean).join("_");
      const fingerprint = {
        semantic,
        structural,
        technical,
        behavioral,
        visual,
      };
      const mappingLayer = this.getMapperMappingLayer(fingerprint);
      const fingerprintDigest = this.hashString(JSON.stringify(fingerprint));
      const componentUid = `uid_${fingerprintDigest}`;
      const mapVersionId = `map_${this.hashString(`${pageProfileKey}|${fingerprintDigest}`)}`;

      return {
        mapperSchemaVersion: 1,
        mapperCoreVersion: "content-adapter.v1",
        action,
        siteKey,
        pageProfileKey,
        componentId,
        componentUid,
        mappingLayer,
        capturedMapVersionId: mapVersionId,
        displayName: this.mapperDisplayName(semantic, technical),
        locatorCandidates,
        fingerprint,
        expectedCapabilities: behavioral.capabilities,
      };
      } finally {
        this.activeMapperFactWorkBudget = previousBudget;
      }
    }

    getMapperMappingLayer(fingerprint = {}) {
      const structural = fingerprint.structural || {};
      const region = structural.regionDynamics || {};
      const repeat = structural.repeatScope || {};
      const scope = structural.platformScope || {};
      if (["dynamic", "loaded_window", "ephemeral_context"].includes(region.classification)) {
        return "dynamic";
      }
      if (repeat.loadedContentOnly === true) return "dynamic";
      if (["loaded_window", "ephemeral"].includes(scope.durability)) return "dynamic";
      if (scope.dynamicKind) return "dynamic";
      return "static";
    }

    createComponentRef(mapperFact = {}) {
      return {
        mapperSchemaVersion: 1,
        componentId: mapperFact.componentId || "",
        componentUid: mapperFact.componentUid || "",
        mappingLayer: mapperFact.mappingLayer || "static",
        siteKey: mapperFact.siteKey || "",
        pageProfileKey: mapperFact.pageProfileKey || "",
        capturedMapVersionId: mapperFact.capturedMapVersionId || "",
      };
    }

    buildMapperSemanticFacts(element, snapshot = {}, platformScope = null) {
      const identityText = this.getMapperIdentityText(element);
      const labelText = this.getAssociatedLabelText(element);
      return {
        role: this.toMapperIdentifier(
          element.getAttribute("role") || this.inferRole(element),
        ),
        accessibleName: this.cleanMapperText(
            element.getAttribute("aria-label") ||
            element.getAttribute("alt") ||
            labelText ||
            identityText,
        ),
        altText: this.cleanMapperText(element.getAttribute("alt")),
        labelText: this.cleanMapperText(labelText),
        stableText: identityText,
        placeholder: this.cleanMapperText(element.getAttribute("placeholder")),
        title: this.cleanMapperText(element.getAttribute("title")),
        name: this.toMapperIdentifier(element.getAttribute("name")),
        inputType: this.toMapperIdentifier(
          element.getAttribute("type") || snapshot.type || "",
        ),
        stableAttributes: this.getStableDataAttributes(element),
        identityTextPolicy: platformScope?.family
          ? "exclude_ephemeral_descendants"
          : "default",
      };
    }

    getMapperIdentityText(element) {
      if (!element || !(element instanceof Element)) return "";
      if (this.isMapperEphemeralElement(element)) return "";
      const skipSelector = [
        "[data-mapper-dynamic='ephemeral']",
        "[data-testid$='-timestamp']",
        "[data-testid$='-unread']",
        "[data-testid='notification-badge']",
        ".dynamic-note",
        ".unread-badge",
        ".ephemeral-badge",
        "time",
      ].join(",");
      return this.cleanMapperText(resolver.getStableElementText(element, {
        workBudget: this.activeMapperFactWorkBudget,
        skipSelector,
      }));
    }

    isMapperEphemeralElement(element) {
      return Boolean(element?.matches?.([
        "[data-mapper-dynamic='ephemeral']",
        "[data-testid$='-timestamp']",
        "[data-testid$='-unread']",
        "[data-testid='notification-badge']",
        ".dynamic-note",
        ".unread-badge",
        ".ephemeral-badge",
        "time",
      ].join(",")));
    }

    getMapperDynamicKind(element) {
      if (!this.isMapperEphemeralElement(element)) return "";
      const testId = this.toMapperIdentifier(element.getAttribute("data-testid"));
      if (testId.includes("timestamp") || element.matches("time, .dynamic-note")) return "timestamp";
      if (testId.includes("unread") || element.matches(".unread-badge")) return "unread_badge";
      if (testId.includes("notification") || element.matches(".ephemeral-badge")) return "notification_badge";
      return "ephemeral_context";
    }

    buildMapperStructuralFacts(element, snapshot = {}) {
      const platformScope = this.getMapperPlatformScope(element);
      const repeatScope = this.getMapperRepeatScope(element, platformScope);
      const form = this.getBoundedMapperClosest(element, "form", "fact_form_ancestor");
      return {
        platformScope,
        frameScope: this.getMapperFrameScope(),
        repeatScope,
        regionDynamics: this.getMapperRegionDynamics(element, platformScope, repeatScope),
        ancestorTokens: [
          this.platformScopeToken(platformScope),
          this.mapperRepeatScopeToken(repeatScope),
          ...this.getMeaningfulAncestorTokens(element),
        ].filter(Boolean).slice(0, 3),
        formName: this.toMapperIdentifier(
          form?.getAttribute("name") ||
            form?.id ||
            "",
        ),
        relativeIndex: this.getSiblingIndex(element),
        nearbyLabel: this.cleanMapperText(snapshot.nearbyText || ""),
      };
    }

    getMapperRepeatScope(element, platformScope = null) {
      if (platformScope?.repeatedKind) {
        return {
          version: "mapper.repeat_scope.v1",
          kind: platformScope.repeatedKind,
          containerId: platformScope.containerId || "",
          itemKey: platformScope.containerId || "",
          loadedWindowIndex: platformScope.loadedWindowIndex || "",
          loadedContentOnly: platformScope.durability === "loaded_window",
          resolutionPolicy: platformScope.containerId ? "pinned_item" : "pattern_requires_condition",
        };
      }

      const row = this.getBoundedMapperClosest(
        element,
        "article, [role='article'], [role='listitem'], tr",
        "fact_repeat_ancestor",
      );
      if (!row) return null;
      const container = row.parentElement;
      const containerSignal = [
        container?.id,
        container?.getAttribute?.("data-testid"),
        container?.getAttribute?.("aria-label"),
        container?.className,
      ].join(" ").toLowerCase();
      if (!/(feed|list|result|table|tree|stream|timeline)/.test(containerSignal)) return null;

      const containerId = this.getMapperStableContainerToken(container, "repeat_container");
      const itemValue = row.getAttribute("data-testid") ||
        row.getAttribute("data-id") ||
        row.getAttribute("data-key") ||
        row.id ||
        "";
      const itemKey = itemValue ? `item_${this.hashString(itemValue)}` : "";
      return {
        version: "mapper.repeat_scope.v1",
        kind: row.matches("tr") ? "table_row" : "feed_item",
        containerId,
        itemKey,
        loadedWindowIndex: String(this.getBoundedMapperSiblingIndex(row, "fact_repeat_sibling")),
        loadedContentOnly: true,
        resolutionPolicy: itemKey ? "pinned_item" : "pattern_requires_condition",
      };
    }

    mapperRepeatScopeToken(scope = null) {
      if (!scope?.kind) return "";
      return [scope.kind, scope.containerId, scope.itemKey]
        .map((value) => this.toMapperIdentifier(value))
        .filter(Boolean)
        .join("_");
    }

    getMapperFrameScope() {
      if (window === window.top) {
        return {
          version: "mapper.frame_scope.v1",
          access: "top",
          path: "top",
          depth: 0,
          extensionAccessible: true,
        };
      }

      const segments = [];
      let current = window;
      try {
        while (current !== current.top && segments.length < 6) {
          if (!this.consumeMapperFactWork("fact_frame_ancestor")) break;
          const frame = current.frameElement;
          if (!frame) throw new Error("frame_element_unavailable");
          const stableValue = frame.getAttribute("data-testid") ||
            frame.getAttribute("name") ||
            frame.id ||
            this.getMapperPathWithinRoot(frame, frame.ownerDocument);
          segments.unshift(`frame_${this.hashString(stableValue || "unknown")}`);
          current = current.parent;
        }
        if (current !== current.top) {
          this.failMapperFactWork("fact_frame_ancestor_depth");
        }
        return {
          version: "mapper.frame_scope.v1",
          access: "same_origin",
          path: ["top", ...segments].join("/"),
          depth: segments.length,
          extensionAccessible: true,
        };
      } catch {
        let referrerContext = "";
        try {
          const referrer = new URL(document.referrer || "");
          referrerContext = `${referrer.origin}${referrer.pathname}`;
        } catch {
          referrerContext = "";
        }
        const contextKey = `frame_${this.hashString([
          location.origin,
          location.pathname,
          window.name || "",
          referrerContext,
        ].join("|"))}`;
        return {
          version: "mapper.frame_scope.v1",
          access: "cross_origin",
          path: `isolated/${contextKey}`,
          depth: 1,
          contextKey,
          extensionAccessible: true,
        };
      }
    }

    getMapperRegionDynamics(element, platformScope = null, repeatScope = null) {
      const regionId = this.getMapperRegionId(element, platformScope, repeatScope);
      const mutationCount = Number(this.mapperMutationStats.regionMutationCounts[regionId]) || 0;
      const ephemeral = platformScope?.durability === "ephemeral";
      const loadedWindow = platformScope?.durability === "loaded_window" ||
        repeatScope?.loadedContentOnly === true;
      return {
        version: "mapper.region_dynamics.v1",
        regionId,
        classification: ephemeral
          ? "ephemeral_context"
          : loadedWindow
            ? "loaded_window"
            : mutationCount >= 10
              ? "dynamic"
              : "static",
        mutationCount,
        loadedContentOnly: loadedWindow,
        bounded: Boolean(regionId),
      };
    }

    getMapperRegionId(element, platformScope = null, repeatScope = null) {
      if (platformScope?.family && platformScope?.region) {
        return this.toMapperIdentifier([
          platformScope.family,
          platformScope.region,
          platformScope.threadId || platformScope.containerId,
        ].filter(Boolean).join("_"));
      }
      if (repeatScope?.containerId) return repeatScope.containerId;
      const region = this.getBoundedMapperClosest(element, [
        "[data-mapper-region]",
        "[data-region]",
        "section[data-testid]",
        "section[id]",
        "main",
        "form",
      ].join(","), "fact_region_ancestor");
      return this.toMapperIdentifier(
        region?.getAttribute("data-mapper-region") ||
          region?.getAttribute("data-region") ||
          region?.getAttribute("data-testid") ||
          region?.id ||
          region?.getAttribute("name") ||
          region?.tagName ||
          "page",
      );
    }

    getMapperPlatformScope(element) {
      const closest = (selector) => this.getBoundedMapperClosest(
        element,
        selector,
        "fact_platform_ancestor",
      );
      const hasExplicitPlatformRoots = this.hasExplicitMapperPlatformRoots();
      const chatRoot = hasExplicitPlatformRoots
        ? closest("[data-platform-profile='chat'], [data-testid='chat-profile']")
        : null;
      if (chatRoot) {
        const ephemeral = this.isMapperEphemeralElement(element);
        const chatShell = closest("[data-testid='chat-app-shell']");
        const profileControls = !chatShell;
        const profileToolbar = profileControls ? closest(".toolbar, [data-chat-region='profile-controls']") : null;
        const navigation = closest("[data-testid='account-navigation'], [data-chat-region='navigation']");
        const contactsPane = closest("[data-testid='contacts-pane'], [data-chat-region='contacts']");
        const composer = closest("[data-testid='message-composer']");
        const conversationList = closest("[data-testid='conversation-list']");
        const conversationRow = closest("[data-testid^='thread-'][data-thread-id]");
        const activeThread = closest("[data-testid='active-thread-region']");
        const messageRow = closest("[data-testid^='message-'][data-thread-id]");
        const loadedWindow = closest("[data-testid='message-loaded-window']");
        const threadHeader = closest("[data-testid='thread-header'], [data-chat-region='thread-header']");
        const searchFilters = closest("[data-testid='chat-search-filters'], [data-chat-region='search-filters']");
        let majorRegion = "chat_pane";
        if (profileControls) {
          majorRegion = "chat_shell";
        } else if (navigation) {
          majorRegion = "navigation_rail";
        } else if (contactsPane || conversationList || conversationRow) {
          majorRegion = "contacts_pane";
        }

        let subregion = "chat_shell";
        if (profileControls) {
          subregion = "profile_controls";
        } else if (navigation) {
          subregion = "navigation_actions";
        } else if (searchFilters) {
          subregion = "search_and_filters";
        } else if (composer) {
          subregion = "message_composer";
        } else if (conversationRow || conversationList) {
          subregion = "conversation_list";
        } else if (threadHeader) {
          subregion = "thread_header";
        } else if (messageRow || loadedWindow) {
          subregion = "message_history";
        } else if (activeThread) {
          subregion = "chat_pane";
        }
        const majorBoundary = profileControls
          ? chatRoot
          : navigation || contactsPane || conversationList || activeThread || chatRoot;
        const subregionBoundary = profileControls
          ? profileToolbar || chatRoot
          : searchFilters || composer ||
          (conversationRow ? conversationList || conversationRow.parentElement : null) || conversationList ||
          threadHeader || (messageRow ? loadedWindow || messageRow.parentElement : null) ||
          loadedWindow || activeThread || majorBoundary;
        const templateKind = messageRow
          ? "message"
          : conversationRow
            ? "contact"
            : "";

        return {
          version: "mapper.platform_scope.v1",
          family: "chat",
          region: subregion,
          majorRegion,
          subregion,
          templateKind,
          templatePart: this.getMapperPlatformTemplatePart(element, templateKind, ephemeral),
          majorRegionPath: this.getMapperDomPath(majorBoundary),
          subregionPath: this.getMapperDomPath(subregionBoundary),
          repeatedRecordPath: this.getMapperDomPath(messageRow || conversationRow),
          majorRegionDepth: this.getMapperComposedAncestorDistance(element, majorBoundary),
          subregionDepth: this.getMapperComposedAncestorDistance(element, subregionBoundary),
          repeatedRecordDepth: this.getMapperComposedAncestorDistance(element, messageRow || conversationRow),
          containerId: this.toMapperIdentifier(
            messageRow?.getAttribute("data-testid") ||
              conversationRow?.getAttribute("data-testid") ||
              profileToolbar?.getAttribute("data-testid") ||
              composer?.getAttribute("data-testid") ||
              conversationList?.getAttribute("data-testid") ||
              activeThread?.getAttribute("data-testid") ||
              chatRoot.getAttribute("data-testid") ||
              "",
          ),
          threadId: this.toMapperIdentifier(
            messageRow?.getAttribute("data-thread-id") ||
              conversationRow?.getAttribute("data-thread-id") ||
              activeThread?.getAttribute("data-active-thread") ||
              "",
          ),
          repeatedKind: messageRow ? "message_row" : conversationRow ? "conversation_row" : "",
          loadedWindowIndex: this.toMapperIdentifier(messageRow?.getAttribute("data-testid") || ""),
          durability: ephemeral
            ? "ephemeral"
            : profileControls || composer || conversationList
              ? "durable"
              : messageRow
                ? "loaded_window"
                : "context",
          dynamicKind: this.getMapperDynamicKind(element),
          mappingDisposition: ephemeral ? "context_only" : "action_or_extract",
        };
      }

      const socialRoot = hasExplicitPlatformRoots
        ? closest("[data-platform-profile='social'], [data-testid='social-profile']")
        : null;
      if (socialRoot) {
        const ephemeral = this.isMapperEphemeralElement(element);
        const socialShell = closest("[data-testid='social-app-shell']");
        const profileControls = !socialShell;
        const profileToolbar = profileControls ? closest(".toolbar, [data-social-region='profile-controls']") : null;
        const navigation = closest("[data-testid='social-navigation'], [data-social-region='navigation']");
        const rightRail = closest("[data-testid='social-right-rail'], [data-social-region='right-rail']");
        const composer = closest("[data-testid='global-comment-composer']");
        const tabs = closest("[data-testid='profile-tabs']");
        const card = closest("[data-testid^='social-card-'][data-loaded-window-index]");
        const loadedWindow = closest("[data-testid='social-loaded-window']");
        const feedRegion = closest("[data-testid='home-feed-region']");
        let majorRegion = "feed_pane";
        if (profileControls) {
          majorRegion = "social_shell";
        } else if (navigation || tabs) {
          majorRegion = "navigation_pane";
        } else if (rightRail) {
          majorRegion = "right_rail";
        }

        let subregion = "social_shell";
        if (profileControls) {
          subregion = "profile_controls";
        } else if (composer) {
          subregion = "comment_composer";
        } else if (tabs) {
          subregion = "profile_tabs";
        } else if (card || loadedWindow) {
          subregion = "feed_stream";
        } else if (feedRegion) {
          subregion = "feed_pane";
        }
        const majorBoundary = profileControls
          ? socialRoot
          : navigation || tabs || rightRail || feedRegion || socialRoot;
        const subregionBoundary = profileControls
          ? profileToolbar || socialRoot
          : composer || tabs ||
          (card ? loadedWindow || feedRegion || card.parentElement : null) ||
          loadedWindow || feedRegion || majorBoundary;

        return {
          version: "mapper.platform_scope.v1",
          family: "social",
          region: subregion,
          majorRegion,
          subregion,
          templateKind: card ? "post" : "",
          templatePart: this.getMapperPlatformTemplatePart(element, card ? "post" : "", ephemeral),
          majorRegionPath: this.getMapperDomPath(majorBoundary),
          subregionPath: this.getMapperDomPath(subregionBoundary),
          repeatedRecordPath: this.getMapperDomPath(card),
          majorRegionDepth: this.getMapperComposedAncestorDistance(element, majorBoundary),
          subregionDepth: this.getMapperComposedAncestorDistance(element, subregionBoundary),
          repeatedRecordDepth: this.getMapperComposedAncestorDistance(element, card),
          containerId: this.toMapperIdentifier(
            card?.getAttribute("data-testid") ||
              profileToolbar?.getAttribute("data-testid") ||
              composer?.getAttribute("data-testid") ||
              tabs?.getAttribute("data-testid") ||
              feedRegion?.getAttribute("data-testid") ||
              socialRoot.getAttribute("data-testid") ||
              "",
          ),
          threadId: "",
          repeatedKind: card ? "feed_card" : "",
          loadedWindowIndex: this.toMapperIdentifier(card?.getAttribute("data-loaded-window-index") || ""),
          durability: ephemeral
            ? "ephemeral"
            : profileControls || composer || tabs
              ? "durable"
              : card
                ? "loaded_window"
                : "context",
          dynamicKind: this.getMapperDynamicKind(element),
          mappingDisposition: ephemeral ? "context_only" : "action_or_extract",
        };
      }

      if (hasExplicitPlatformRoots) return null;

      const detectedFamily = this.currentMapperPlatformProfile?.family || "generic";
      if (detectedFamily === "chat") return this.getInferredChatPlatformScope(element);
      if (detectedFamily === "social") return this.getInferredSocialPlatformScope(element);

      return null;
    }

    hasExplicitMapperPlatformRoots() {
      return this.currentMapperPlatformProfile?.explicitPlatformRoots === true;
    }

    getInferredChatPlatformScope(element) {
      const ephemeral = this.isMapperEphemeralElement(element);
      const major = this.getMapperInferredMajorRegion(element, "chat");
      const composer = this.getMapperComposerBoundary(element);
      const search = this.getMapperSearchBoundary(element);
      const header = this.getMapperHeaderBoundary(element, major.element);
      const repeatedRow = this.getMapperRepeatedRecord(element, major.name);
      const templateKind = repeatedRow
        ? major.name === "contacts_pane" ? "contact" : "message"
        : "";
      const subregion = composer
        ? "message_composer"
        : search && major.name === "contacts_pane"
          ? "search_and_filters"
          : repeatedRow
            ? templateKind === "contact" ? "conversation_list" : "message_history"
            : header && major.name === "chat_pane"
              ? "thread_header"
              : major.name === "navigation_rail"
                ? "navigation_actions"
                : major.name === "contacts_pane"
                  ? "conversation_list"
                  : "message_history";
      const subregionBoundary = composer || search ||
        (repeatedRow ? this.getMapperRepeatedCollectionBoundary(repeatedRow, major.element) : null) ||
        header || major.element;
      const containerId = repeatedRow
        ? this.getMapperStableContainerToken(repeatedRow, templateKind, {
            allowIdentityHash: true,
          })
        : this.getMapperStableContainerToken(composer || search || header || major.element, subregion);
      const unsupportedRepeated = Boolean(repeatedRow && !containerId);
      return {
        version: "mapper.platform_scope.v1",
        family: "chat",
        region: subregion,
        majorRegion: major.name,
        subregion,
        templateKind,
        templatePart: this.getMapperPlatformTemplatePart(element, templateKind, ephemeral),
        majorRegionPath: this.getMapperDomPath(major.element),
        subregionPath: this.getMapperDomPath(subregionBoundary),
        repeatedRecordPath: this.getMapperDomPath(repeatedRow),
        majorRegionDepth: this.getMapperComposedAncestorDistance(element, major.element),
        subregionDepth: this.getMapperComposedAncestorDistance(element, subregionBoundary),
        repeatedRecordDepth: this.getMapperComposedAncestorDistance(element, repeatedRow),
        containerId,
        threadId: major.name === "chat_pane"
          ? this.getMapperStableContainerToken(major.element, "thread", { allowIdentityHash: false })
          : "",
        repeatedKind: templateKind ? `${templateKind}_row` : "",
        loadedWindowIndex: "",
        durability: ephemeral ? "ephemeral" : repeatedRow ? "loaded_window" : composer ? "durable" : "context",
        dynamicKind: this.getMapperDynamicKind(element),
        mappingDisposition: unsupportedRepeated
          ? "unsupported_scope"
          : ephemeral
            ? "context_only"
            : "action_or_extract",
        scopeSource: "inferred_landmarks",
        confidence: unsupportedRepeated ? 45 : major.confidence,
      };
    }

    getInferredSocialPlatformScope(element) {
      const ephemeral = this.isMapperEphemeralElement(element);
      const major = this.getMapperInferredMajorRegion(element, "social");
      const composer = this.getMapperComposerBoundary(element);
      const search = this.getMapperSearchBoundary(element);
      const header = this.getMapperHeaderBoundary(element, major.element);
      const card = this.getMapperRepeatedRecord(element, major.name);
      const tabs = this.getBoundedMapperClosest(
        element,
        "[role='tablist'], nav, [role='navigation']",
        "fact_social_tabs_ancestor",
      );
      const subregion = composer
        ? "comment_composer"
        : search && major.name === "navigation_pane"
          ? "search_and_navigation"
        : card
          ? "feed_stream"
          : tabs
            ? "profile_tabs"
            : header && major.name === "feed_pane"
              ? "feed_header"
              : major.name === "right_rail"
                ? "recommendations"
                : major.name === "navigation_pane"
                  ? "navigation"
                  : "feed_stream";
      const subregionBoundary = composer || search ||
        (card ? this.getMapperRepeatedCollectionBoundary(card, major.element) : null) ||
        tabs || header || major.element;
      const containerId = card
        ? this.getMapperStableContainerToken(card, "post", { allowIdentityHash: true })
        : this.getMapperStableContainerToken(composer || tabs || search || header || major.element, subregion);
      const unsupportedRepeated = Boolean(card && !containerId);
      return {
        version: "mapper.platform_scope.v1",
        family: "social",
        region: subregion,
        majorRegion: major.name,
        subregion,
        templateKind: card ? "post" : "",
        templatePart: this.getMapperPlatformTemplatePart(element, card ? "post" : "", ephemeral),
        majorRegionPath: this.getMapperDomPath(major.element),
        subregionPath: this.getMapperDomPath(subregionBoundary),
        repeatedRecordPath: this.getMapperDomPath(card),
        majorRegionDepth: this.getMapperComposedAncestorDistance(element, major.element),
        subregionDepth: this.getMapperComposedAncestorDistance(element, subregionBoundary),
        repeatedRecordDepth: this.getMapperComposedAncestorDistance(element, card),
        containerId,
        threadId: "",
        repeatedKind: card ? "feed_card" : "",
        loadedWindowIndex: "",
        durability: ephemeral ? "ephemeral" : card ? "loaded_window" : composer || tabs ? "durable" : "context",
        dynamicKind: this.getMapperDynamicKind(element),
        mappingDisposition: unsupportedRepeated
          ? "unsupported_scope"
          : ephemeral
            ? "context_only"
            : "action_or_extract",
        scopeSource: "inferred_landmarks",
        confidence: unsupportedRepeated ? 45 : major.confidence,
      };
    }

    getMapperRepeatedCollectionBoundary(record = null, fallback = null) {
      if (!record) return fallback;
      const semanticCollection = this.getBoundedMapperClosest(record, [
        "[role='list']",
        "[role='feed']",
        "[role='log']",
        "[role='grid']",
        "[aria-live]",
        "ul",
        "ol",
        "tbody",
      ].join(","), "fact_collection_ancestor");
      if (semanticCollection && semanticCollection !== record) return semanticCollection;
      const parent = record.parentElement;
      if (parent && (!fallback || fallback.contains(parent))) return parent;
      return fallback;
    }

    getMapperComposedAncestorDistance(element = null, ancestor = null) {
      if (!element || !ancestor) return 0;
      let current = element;
      let depth = 0;
      while (current) {
        if (!this.consumeMapperFactWork("fact_composed_ancestor")) return 0;
        if (current === ancestor) return depth;
        current = this.getMapperComposedParentElement(current);
        depth += 1;
      }
      return 0;
    }

    getMapperInferredMajorRegion(element, family = "chat") {
      const navigation = this.getBoundedMapperClosest(element, "nav, [role='navigation']", "fact_inferred_region_ancestor");
      const main = this.getBoundedMapperClosest(element, "main, [role='main']", "fact_inferred_region_ancestor");
      const complementary = this.getBoundedMapperClosest(element, "aside, [role='complementary']", "fact_inferred_region_ancestor");
      const layoutPane = this.getMapperLargePaneBoundary(element);
      const boundary = navigation || main || complementary || layoutPane || document.body;
      const rect = boundary?.getBoundingClientRect?.() || {};
      const viewportWidth = Math.max(Number(window.innerWidth) || 0, 1);
      const centerRatio = ((Number(rect.left) || 0) + (Number(rect.width) || 0) / 2) / viewportWidth;

      if (family === "chat") {
        const narrowNavigation = Boolean(navigation && (Number(rect.width) || 0) <= viewportWidth * 0.2);
        if (narrowNavigation || centerRatio <= 0.12) {
          return { name: "navigation_rail", element: navigation || layoutPane || boundary, confidence: navigation ? 88 : 72 };
        }
        if (complementary || (!main && centerRatio <= 0.42)) {
          return { name: "contacts_pane", element: complementary || layoutPane || boundary, confidence: complementary ? 82 : 70 };
        }
        return { name: "chat_pane", element: main || layoutPane || boundary, confidence: main ? 88 : 72 };
      }

      if (navigation || centerRatio <= 0.24) {
        return { name: "navigation_pane", element: navigation || layoutPane || boundary, confidence: navigation ? 86 : 68 };
      }
      if (complementary || centerRatio >= 0.78) {
        return { name: "right_rail", element: complementary || layoutPane || boundary, confidence: complementary ? 82 : 68 };
      }
      return { name: "feed_pane", element: main || layoutPane || boundary, confidence: main ? 88 : 72 };
    }

    getMapperLargePaneBoundary(element) {
      const viewportWidth = Math.max(Number(window.innerWidth) || 0, 1);
      const viewportHeight = Math.max(Number(window.innerHeight) || 0, 1);
      let current = element;
      let fallback = null;
      for (let depth = 0; current && current !== document.body && depth < 10; depth += 1) {
        if (!this.consumeMapperFactWork("fact_pane_ancestor")) return null;
        const rect = current.getBoundingClientRect?.() || {};
        const width = Number(rect.width) || 0;
        const height = Number(rect.height) || 0;
        if (width >= viewportWidth * 0.08 && height >= viewportHeight * 0.45) {
          fallback = current;
          const parentRect = current.parentElement?.getBoundingClientRect?.() || {};
          if ((Number(parentRect.width) || 0) >= viewportWidth * 0.72 && width <= viewportWidth * 0.82) {
            return current;
          }
        }
        current = current.parentElement;
      }
      return fallback;
    }

    getMapperComposerBoundary(element) {
      const candidate = this.getBoundedMapperClosest(
        element,
        "form, [role='form'], footer, [data-lexical-editor='true']",
        "fact_composer_ancestor",
      );
      if (!candidate) return null;
      const hasEditor = candidate.matches("textarea, input, [contenteditable='true']") ||
        Boolean(this.findBoundedMapperDescendant(
          candidate,
          "textarea, input[type='text'], [contenteditable='true'], [role='textbox']",
          "fact_composer_descendant",
        ));
      return hasEditor ? candidate : null;
    }

    getMapperSearchBoundary(element) {
      const searchControl = element.matches?.("input[type='search'], [role='searchbox']")
        ? element
        : this.findBoundedMapperDescendant(
            this.getBoundedMapperClosest(element, "[role='search'], form", "fact_search_ancestor"),
            "input[type='search'], [role='searchbox']",
            "fact_search_descendant",
          );
      if (!searchControl) return null;
      return this.getBoundedMapperClosest(searchControl, "[role='search'], form", "fact_search_ancestor") || searchControl;
    }

    getMapperHeaderBoundary(element, majorBoundary = null) {
      const header = this.getBoundedMapperClosest(
        element,
        "header, [role='banner'], [data-testid*='header' i]",
        "fact_header_ancestor",
      );
      if (header && (!majorBoundary || majorBoundary.contains(header))) return header;
      return null;
    }

    getMapperRepeatedRecord(element, majorRegion = "") {
      const semantic = this.getBoundedMapperClosest(
        element,
        "[role='listitem'], [role='row'], article, [role='article']",
        "fact_repeat_record_ancestor",
      );
      if (semantic?.matches("[role='listitem'], [role='row']")) return semantic;
      if (semantic) {
        const signature = this.getMapperStructureSignature(semantic);
        if (this.countBoundedMapperMatchingSiblings(semantic, signature) >= 2) {
          return semantic;
        }
      }
      let current = element;
      for (let depth = 0; current?.parentElement && depth < 7; depth += 1) {
        const tag = current.tagName?.toLowerCase?.() || "";
        if (["button", "a", "input", "textarea", "svg", "path"].includes(tag)) {
          current = current.parentElement;
          continue;
        }
        const rect = current.getBoundingClientRect?.() || {};
        const parent = current.parentElement;
        const signature = this.getMapperStructureSignature(current);
        const matchingCount = this.countBoundedMapperMatchingSiblings(current, signature);
        const minimumWidth = majorRegion === "contacts_pane" ? 120 : 160;
        if (
          signature && matchingCount >= 2 &&
          (Number(rect.width) || 0) >= minimumWidth &&
          (Number(rect.height) || 0) >= 24
        ) {
          return current;
        }
        current = parent;
      }
      return null;
    }

    countBoundedMapperMatchingSiblings(element, signature) {
      const parent = element?.parentElement;
      if (!parent || !signature) return 0;
      let count = 0;
      let sibling = parent.firstElementChild;
      while (sibling) {
        if (!this.consumeMapperFactWork("fact_repeat_sibling")) return 0;
        if (this.getMapperStructureSignature(sibling) === signature) {
          count += 1;
          if (count >= 2) return count;
        }
        sibling = sibling.nextElementSibling;
      }
      return count;
    }

    getMapperStructureSignature(element) {
      if (!element) return "";
      const classes = this.getBoundedMapperClassTokens(element, 3).sort();
      return [
        element.tagName?.toLowerCase?.() || "",
        element.getAttribute?.("role") || "",
        ...classes,
      ].join("|");
    }

    getMapperPlatformTemplatePart(element, templateKind = "", ephemeral = false) {
      if (!templateKind) return "";
      if (ephemeral || element.matches?.("time")) return "metadata";
      const tag = element.tagName?.toLowerCase?.() || "";
      const role = element.getAttribute?.("role") || this.inferRole(element);
      if (["img", "picture", "svg", "canvas"].includes(tag) || role === "img") return "media";
      if (this.getBoundedMapperClosest(
        element,
        "[role='toolbar'], [class*='action' i], [aria-label*='action' i]",
        "fact_template_ancestor",
      )) return "actions";
      if (element.matches?.("input, textarea, [contenteditable='true'], [role='textbox']")) return "input";
      if (templateKind === "contact") return "identity_preview";
      return "content";
    }

    getMapperStableContainerToken(element, prefix = "region", options = {}) {
      if (!element) return "";
      const stableValue = element.getAttribute("data-testid") ||
        element.getAttribute("data-id") ||
        element.getAttribute("data-key") ||
        element.id ||
        "";
      if (stableValue) return `${this.toMapperIdentifier(prefix)}_${this.hashString(stableValue)}`;
      if (options.allowIdentityHash !== true) return "";
      const identity = this.getMapperIdentityText(element);
      if (!identity) return "";
      const normalized = this.toMapperIdentifier(identity);
      if (!normalized) return "";
      let duplicateCount = 0;
      let sibling = element.parentElement?.firstElementChild || null;
      while (sibling) {
        if (!this.consumeMapperFactWork("fact_identity_sibling")) return "";
        if (this.toMapperIdentifier(this.getMapperIdentityText(sibling)) === normalized) {
          duplicateCount += 1;
          if (duplicateCount > 1) return "";
        }
        sibling = sibling.nextElementSibling;
      }
      if (duplicateCount !== 1) return "";
      return `${this.toMapperIdentifier(prefix)}_${this.hashString(normalized)}`;
    }

    platformScopeToken(scope = null) {
      if (!scope?.family || scope.family === "generic") return "";
      return [scope.family, scope.majorRegion, scope.subregion || scope.region, scope.threadId || scope.containerId]
        .map((value) => this.toMapperIdentifier(value))
        .filter(Boolean)
        .slice(0, 4)
        .join("_");
    }

    buildMapperTechnicalFacts(element, snapshot = {}) {
      const shadowPath = this.getMapperShadowPath(element);
      return {
        tag: this.toMapperIdentifier(element.tagName),
        id: this.toMapperIdentifier(element.id),
        classes: this.getBoundedMapperClassTokens(element, 8),
        domPath: shadowPath.length
          ? this.getMapperDomPath(element)
          : snapshot.domPath || this.getDomIndexPath(element),
        shadowPath,
      };
    }

    buildMapperBehavioralFacts(element, action = "", snapshot = {}) {
      return {
        capabilities: this.inferMapperCapabilities(element, action),
        href: this.cleanMapperText(element.getAttribute("href") || snapshot.href || ""),
        dynamicContext: this.isMapperEphemeralElement(element),
        state: {
          disabled: Boolean(element.disabled) ||
            element.getAttribute("aria-disabled") === "true",
          readonly: Boolean(element.readOnly),
        },
      };
    }

    getViewportBounds(element) {
      if (!element?.getBoundingClientRect) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    getDocumentBounds(element) {
      if (!element?.getBoundingClientRect) return null;
      const rect = element.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;
      return {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        left: Math.round(rect.left + scrollX),
        top: Math.round(rect.top + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    inferMapperCapabilities(element, action = "") {
      const tag = element.tagName?.toLowerCase?.() || "";
      const type = (element.getAttribute("type") || "").toLowerCase();
      const role = (element.getAttribute("role") || "").toLowerCase();
      const capabilities = new Set(["extract"]);

      if (
        ["button", "a", "summary", "select"].includes(tag) ||
        ["button", "link", "menuitem", "tab", "checkbox", "radio"].includes(role)
      ) {
        capabilities.add("click");
      }
      if (
        ["img", "picture", "svg", "canvas"].includes(tag) ||
        role === "img"
      ) {
        capabilities.add("click");
        capabilities.add("screenshot");
      }
      if (this.isPointerClickableElement(element)) {
        capabilities.add("click");
      }

      if (
        ["textarea"].includes(tag) ||
        element.isContentEditable ||
        role === "textbox" ||
        (tag === "input" && ![
          "button",
          "submit",
          "reset",
          "checkbox",
          "radio",
          "file",
          "hidden",
        ].includes(type))
      ) {
        capabilities.add("type");
        capabilities.add("clear");
      }

      if (tag === "select") capabilities.add("select");
      if (tag === "input" && type === "file") capabilities.add("upload");
      if (action === Actions.ElementToggle) capabilities.add("toggle");

      return Array.from(capabilities);
    }

    getAssociatedLabelText(element) {
      if (!element || !(element instanceof Element)) return "";

      const labelCount = Math.min(Number(element.labels?.length || 0), 16);
      for (let index = 0; index < labelCount; index += 1) {
        if (!this.consumeMapperFactWork("fact_associated_label")) return "";
        const label = element.labels[index];
        const text = this.cleanMapperText(resolver.getBoundedElementText(label, {
          workBudget: this.activeMapperFactWorkBudget,
          maxChars: 160,
        }));
        if (text) return text;
      }

      const wrappingLabel = this.getBoundedMapperClosest(
        element,
        "label",
        "fact_label_ancestor",
      );
      return this.cleanMapperText(
        resolver.getBoundedElementText(wrappingLabel, {
          workBudget: this.activeMapperFactWorkBudget,
          maxChars: 160,
        }),
      );
    }

    getStableDataAttributes(element) {
      const attrs = {};
      [
        "data-testid",
        "data-test",
        "data-qa",
        "data-cy",
        "data-automation-id",
        "data-component",
      ].forEach((name) => {
        const value = this.cleanMapperText(element.getAttribute(name));
        if (value) attrs[name] = value;
      });
      return attrs;
    }

    getMeaningfulAncestorTokens(element) {
      const tokens = [];
      let current = element.parentElement;
      while (
        current &&
        tokens.length < 2 &&
        current !== document.body
      ) {
        if (!this.consumeMapperFactWork("fact_meaningful_ancestor")) return [];
        const token = this.cleanMapperText(
          current.getAttribute("aria-label") ||
            current.getAttribute("data-testid") ||
            current.getAttribute("data-test") ||
            current.getAttribute("data-qa") ||
            current.id ||
            current.getAttribute("role") ||
            current.tagName,
        );
        if (token) tokens.push(token);
        current = current.parentElement;
      }

      return tokens;
    }

    getSiblingIndex(element) {
      const parent = element?.parentElement;
      if (!parent) return null;
      return this.getBoundedMapperSiblingIndex(element, "fact_relative_sibling");
    }

    inferRole(element) {
      const tag = element.tagName?.toLowerCase?.() || "";
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (["input", "textarea"].includes(tag)) return "textbox";
      if (tag === "select") return "listbox";
      if (["img", "picture", "svg", "canvas"].includes(tag)) return "img";
      if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) return "heading";
      if (["p", "span", "label", "li", "td", "th"].includes(tag)) return "text";
      return tag;
    }

    mapperComponentSeed(semantic = {}, technical = {}) {
      return this.toMapperIdentifier(
        semantic.stableAttributes?.["data-testid"] ||
          semantic.stableAttributes?.["data-test"] ||
          semantic.stableAttributes?.["data-qa"] ||
          [semantic.accessibleName, semantic.role].filter(Boolean).join(" ") ||
          [semantic.altText, semantic.role].filter(Boolean).join(" ") ||
          [semantic.labelText, semantic.role || semantic.inputType].filter(Boolean).join(" ") ||
          [semantic.stableText, semantic.role].filter(Boolean).join(" ") ||
          semantic.name ||
          semantic.placeholder ||
          semantic.title ||
          technical.id ||
          semantic.role ||
          technical.tag ||
          "component",
      );
    }

    mapperDisplayName(semantic = {}, technical = {}) {
      return this.cleanMapperText(
        semantic.accessibleName ||
          semantic.altText ||
          semantic.labelText ||
          semantic.stableText ||
          semantic.placeholder ||
          semantic.title ||
          semantic.name ||
          semantic.role ||
          technical.tag ||
          "Component",
      );
    }

    mapperPageName(path = "/") {
      const cleaned = String(path || "/").replace(/^\/+|\/+$/g, "");
      return cleaned ? this.toMapperIdentifier(cleaned.replace(/\//g, "_")) : "home";
    }

    mapperPageProfile(page = {}, settings = {}) {
      try {
        const parsed = new URL(page.url || location.href);
        const path = parsed.pathname || "/";
        const query = this.mapperAllowlistedQuery(
          parsed.searchParams,
          settings.queryAllowlist,
        );
        const siteKey = this.toMapperIdentifier(parsed.hostname.replace(/\./g, "_")) || "site";
        const pageName = this.mapperPageName(path).slice(0, 160);
        const identity = this.mapperPageIdentityDigest(parsed.origin, path, query);
        return {
          origin: parsed.origin,
          path,
          query,
          siteKey,
          pageName,
          pageProfileKey: `${siteKey}::${pageName}::identity_v2_${identity}`,
        };
      } catch {
        return {
          origin: "",
          path: "",
          query: "",
          siteKey: "site",
          pageName: "page",
          pageProfileKey: "",
        };
      }
    }

    mapperAllowlistedQuery(searchParams = new URLSearchParams(), allowlist = []) {
      const query = new URLSearchParams();
      [...new Set((Array.isArray(allowlist) ? allowlist : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean))]
        .sort()
        .forEach((key) => {
          searchParams.getAll(key).forEach((value) => query.append(key, value));
        });
      return query.toString();
    }

    mapperPageIdentityDigest(origin = "", path = "/", query = "") {
      const value = JSON.stringify([
        String(origin || ""),
        String(path || "/"),
        String(query || ""),
      ]);
      return `${this.mapperFnv1a64(value)}${this.mapperFnv1a64(value, 0x84222325cbf29ce4n, true)}`;
    }

    mapperFnv1a64(value = "", offset = 0xcbf29ce484222325n, reverse = false) {
      let hash = offset;
      const text = String(value || "");
      let index = reverse ? text.length - 1 : 0;
      const end = reverse ? -1 : text.length;
      const direction = reverse ? -1 : 1;
      for (; index !== end; index += direction) {
        hash ^= BigInt(text.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
      }
      return hash.toString(16).padStart(16, "0");
    }

    mapperPageMatchesCurrentLocation(pageMap = {}, settings = {}) {
      if (!pageMap?.origin && !pageMap?.path && !pageMap?.pageProfileKey) return true;
      if (window.top !== window) return true;

      try {
        const profile = this.mapperPageProfile({ url: location.href }, settings);
        if (pageMap.origin && pageMap.origin !== profile.origin) return false;
        if (pageMap.siteKey && pageMap.siteKey !== profile.siteKey) return false;
        if (pageMap.path && pageMap.path !== profile.path) return false;
        if (typeof pageMap.query === "string" && pageMap.query !== profile.query) return false;
        const collisionSafeKey = /::identity_v2_[0-9a-f]{32}$/.test(
          String(pageMap.pageProfileKey || ""),
        );
        if (collisionSafeKey && pageMap.pageProfileKey !== profile.pageProfileKey) return false;
        const hasPersistedExactIdentity = Boolean(
          pageMap.origin && pageMap.path && typeof pageMap.query === "string",
        );
        if (pageMap.pageProfileKey && !collisionSafeKey && !hasPersistedExactIdentity) return false;
        return true;
      } catch {
        return false;
      }
    }

    cleanMapperText(value) {
      return String(value || "").trim().replace(/\s+/g, " ");
    }

    toMapperIdentifier(value) {
      return String(value || "")
        .normalize("NFKD")
        .replace(/[^\x00-\x7F]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
    }

    escapeCssString(value) {
      return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    async executeStep(step = {}, runId = "") {
      this.throwIfExecutionCancelled(runId);

      const action = step.action || step.type;

      if (action === Actions.LogicWait) {
        await this.delay(Number(step.ms || step.duration || 1000));
        return {
          ok: true,
        };
      }

      if (action === Actions.DataExtractPage) {
        return {
          ok: true,
          value: this.extractPageValue(step.config?.field || "all"),
          usedStrategy: "page_context",
          usedValue: step.config?.field || "all",
        };
      }

      if (action === Actions.BrowserScroll) {
        window.scrollBy({
          left: Number(step.config?.x || 0),
          top: Number(step.config?.y || 0),
          behavior: "instant",
        });

        return {
          ok: true,
          usedStrategy: "window.scrollBy",
        };
      }

      if (this.isConditionalWaitAction(action)) {
        return await this.executeConditionalWait(step, runId);
      }

      const resolved = this.resolveStepTarget(step, action);

      if (!resolved.element) {
        return {
          ok: false,
          error: resolved.mapperState
            ? `Mapper could not resolve target: ${resolved.mapperState}`
            : `Could not resolve target for step: ${action || "unknown"}`,
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            resolved.mapperState
              ? `mapper_${resolved.mapperState}`
              : "target_resolution_failed",
          ),
        };
      }

      const element = resolved.element;
      const complete = (payload) => this.withMapperRuntimeResolution(payload, step, resolved);

      if (action === Actions.FileInputUpload) {
        const value = this.executeFileInputUpload(element, step.config || {});

        return complete({
          ok: true,
          value,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementScrollIntoView) {
        element.scrollIntoView({
          block: step.config?.block || "center",
          inline: "nearest",
          behavior: "instant",
        });

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementHover) {
        await this.executeHover(element);

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (!this.passesJitOcclusionCheck(element)) {
        return {
          ok: false,
          error: "Target element is occluded or not interactable.",
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            "target_occluded_or_not_interactable",
          ),
        };
      }

      if (action === Actions.ElementClick) {
        await this.executeClick(element);
        this.assertPostActionVerification(step, resolved);

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementType) {
        await this.executeType(element, this.stepTextValue(step));
        this.assertPostActionVerification(step, resolved);

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementExtract) {
        const value = this.extractValue(element);

        return complete({
          ok: true,
          value,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementDoubleClick) {
        await this.executeDoubleClick(element);
        this.assertPostActionVerification(step, resolved);

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementClear) {
        await this.executeType(element, "");

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.DataExtractText) {
        return complete({
          ok: true,
          value: this.extractTextValue(element),
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.DataExtractAttribute) {
        const attributeName = String(
          step.config?.attributeName || "",
        ).trim();

        if (!attributeName) {
          throw new Error("Extract Attribute requires an attribute name.");
        }

        return complete({
          ok: true,
          value: element.getAttribute(attributeName) ?? "",
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.DataExtractList) {
        return complete({
          ok: true,
          value: this.extractListValue(element, step.config || {}),
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.DataExtractTable) {
        return complete({
          ok: true,
          value: this.extractTableValue(element, step.config || {}),
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementFocus) {
        await this.executeFocus(element);

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementSelect) {
        await this.executeSelect(
          element,
          this.stepOptionValue(step),
        );

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      if (action === Actions.ElementToggle) {
        await this.executeToggle(element, this.stepToggleValue(step));

        return complete({
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        });
      }

      return {
        ok: false,
        error: `Unsupported content action: ${action || "undefined"}`,
        diagnostics: this.createExecutionDiagnostics(
          step,
          resolved,
          "unsupported_content_action",
        ),
      };
    }

    async prepareHostFallback(step = {}, runId = "") {
      this.throwIfExecutionCancelled(runId);

      const action = step.action || step.type;
      const hostAction = this.toHostFallbackAction(action);
      if (!hostAction) {
        return {
          ok: false,
          error: `Host fallback is not supported for ${action || "unknown"}.`,
          diagnostics: {
            action: action || "unknown",
            finalReason: "host_fallback_unsupported_action",
          },
        };
      }

      const resolved = this.resolveStepTarget(step, action);
      if (!resolved.element) {
        return {
          ok: false,
          error: `Could not resolve target for host fallback: ${action || "unknown"}`,
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            "host_fallback_target_resolution_failed",
          ),
        };
      }

      const element = resolved.element;
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await this.delay(50);

      if (action === Actions.ElementType) {
        const focusResult = await this.focusHostFallbackTypeTarget(element);
        if (!focusResult.ok) {
          return {
            ok: false,
            error: focusResult.error,
            diagnostics: {
              ...this.createExecutionDiagnostics(
                step,
                resolved,
                focusResult.reason,
              ),
              focus: {
                expectedTag: String(element.tagName || "").toLowerCase(),
                activeTag: String(
                  focusResult.activeElement?.tagName || "",
                ).toLowerCase(),
              },
            },
          };
        }
      }

      const rect = element.getBoundingClientRect();
      const clientPoint = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const devicePixelRatio = Number(window.devicePixelRatio || 1);
      const clientBounds = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio,
      };
      const confidence = this.normalizeHostCoordinateConfidence(
        resolved.confidence,
      );
      const visible = this.isVisibleElement(element);
      const interactable = this.passesJitOcclusionCheck(element);

      return {
        ok: true,
        action: hostAction,
        text: action === Actions.ElementType ? this.stepTextValue(step) : "",
        confidence,
        coordinateSpace: "css_viewport",
        clientPoint,
        clientBounds,
        devicePixelRatio,
        window: {
          title: document.title || "",
          url: window.location.href,
        },
        visible,
        interactable,
        usedStrategy: resolved.strategy,
        usedValue: resolved.value,
      };
    }

    async verifyHostFallback(step = {}, runId = "") {
      this.throwIfExecutionCancelled(runId);

      const action = step.action || step.type;
      const resolved = this.resolveStepTarget(step, action);
      if (!resolved.element) {
        return {
          ok: false,
          error: "Host fallback verification could not resolve target.",
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            "host_fallback_verification_target_missing",
          ),
        };
      }

      if (action === Actions.ElementType) {
        const expected = this.stepTextValue(step);
        const actual = this.extractValue(resolved.element);
        if (actual !== expected) {
          return {
            ok: false,
            error: "Host fallback typed value verification failed.",
            diagnostics: {
              ...this.createExecutionDiagnostics(
                step,
                resolved,
                "host_fallback_verification_failed",
              ),
              expectedLength: expected.length,
              actualLength: actual.length,
            },
          };
        }
      }

      this.assertPostActionVerification(step, resolved);

      return {
        ok: true,
        usedStrategy: resolved.strategy,
        usedValue: resolved.value,
        verification: "target_resolved",
      };
    }

    toHostFallbackAction(action) {
      if (action === Actions.ElementClick) return "click";
      if (action === Actions.ElementDoubleClick) return "doubleClick";
      if (action === Actions.ElementType) return "type";
      return "";
    }

    resolveStepTarget(step = {}, action = "") {
      if (step.mapperContext?.component) {
        return this.resolveMapperComponentTarget(step, action);
      }

      return resolver.resolveRecordedTarget(step, this.controls);
    }

    resolveMapperComponentTarget(step = {}, action = "") {
      const context = step.mapperContext || {};
      const component = context.component;
      const classification = context.pageMap?.classification || "";
      const includeHidden = context.includeHidden === true;
      const maxComponents = this.normalizeMapperMaxComponents(
        context.maxComponents ??
          context.pageMap?.maxComponents ??
          context.pageMap?.diagnostics?.maxComponents ??
          this.mapperMaxComponents,
      );
      const platformScope = component?.fingerprint?.structural?.platformScope || {};
      const frameScope = component?.fingerprint?.structural?.frameScope || {};
      const repeatScope = component?.fingerprint?.structural?.repeatScope || {};
      const runtimeWorkBudget = this.createMapperWorkBudget(
        context.maxRuntimeWork,
        DEFAULT_MAPPER_RUNTIME_WORK,
        MAX_MAPPER_RUNTIME_WORK,
      );
      const runtimeFactBudget = this.createMapperFactWorkBudget({
        maxComponents,
        maxFactWork: context.maxFactWork,
      });

      if (context.state && context.state !== "ready") {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: context.state,
          mapperReason: context.reason || "mapper_context_not_ready",
          strategy: null,
          value: null,
          confidence: 0,
          attempts: [],
        }, component, action, []);
      }

      if (classification === "dynamic_deferred") {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "dynamic_deferred",
          mapperReason: "dynamic_deferred",
          strategy: null,
          value: null,
          confidence: 0,
          attempts: [],
        }, component, action, []);
      }

      if (!this.mapperPlatformScopeAllowsAction(platformScope, action)) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "protected_unsupported",
          mapperReason: "platform_scope_insufficient",
          strategy: null,
          value: null,
          confidence: Number(platformScope.confidence) || 0,
          attempts: [],
        }, component, action, []);
      }

      if (
        frameScope.access === "cross_origin" &&
        frameScope.extensionAccessible !== true
      ) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "protected_unsupported",
          mapperReason: "cross_origin_frame_unreachable",
          strategy: null,
          value: null,
          confidence: 0,
          attempts: [],
        }, component, action, []);
      }

      if (
        frameScope.access === "cross_origin" &&
        frameScope.identityAmbiguous === true
      ) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "ambiguous",
          mapperReason: "cross_origin_frame_context_ambiguous",
          strategy: null,
          value: null,
          confidence: 0,
          attempts: [],
        }, component, action, []);
      }

      if (repeatScope.resolutionPolicy === "pattern_requires_condition") {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "protected_unsupported",
          mapperReason: "repeat_condition_required",
          strategy: null,
          value: null,
          confidence: 0,
          attempts: [],
        }, component, action, []);
      }

      const directResolution = this.resolveStoredMapperLocatorTarget(
        component,
        action,
        {
          includeHidden,
          maxComponents,
          workBudget: runtimeWorkBudget,
          factWorkBudget: runtimeFactBudget,
        },
      );
      if (directResolution) return directResolution;

      const enumeration = this.enumerateMapperCandidates(action, {
        includeHidden,
        component,
        maxComponents,
        workBudget: runtimeWorkBudget,
        factWorkBudget: runtimeFactBudget,
      });
      if (enumeration.overflow) {
        return this.mapperComponentScanOverflowResolution(
          component,
          action,
          enumeration,
        );
      }
      const candidates = enumeration.candidates;
      const primaryMatches = candidates.filter((candidate) => {
        return this.mapperCandidateHasLocator(candidate, component.primaryLocator);
      });

      if (primaryMatches.length === 1) {
        return this.mapperResolutionFromCandidate(
          primaryMatches[0],
        component.primaryLocator,
        "resolved",
        "primary_locator_unique",
        100,
        component,
      );
      }

      if (primaryMatches.length > 1) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "ambiguous",
          mapperReason: "primary_locator_ambiguous",
          strategy: component.primaryLocator?.strategy || null,
          value: component.primaryLocator?.value || null,
          confidence: 0,
          attempts: primaryMatches.map((candidate) => candidate.summary),
        }, component, action, primaryMatches.map((candidate) => ({
          candidate,
          score: 100,
          evidence: ["primary_locator"],
        })));
      }

      const scored = candidates
        .map((candidate) => ({
          candidate,
          ...this.scoreMapperCandidateWithEvidence(component, candidate),
        }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const runnerUp = scored[1];

      if (!best || best.score < 75) {
        const expectedScope = component.fingerprint?.structural?.platformScope || {};
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "not_found",
          mapperReason: !best && expectedScope.family && expectedScope.family !== "generic"
            ? "no_platform_scope_compatible_candidates"
            : "below_threshold",
          strategy: null,
          value: null,
          confidence: best?.score || 0,
          attempts: scored.slice(0, 3).map((result) => ({
            ...result.candidate.summary,
            score: result.score,
            evidence: result.evidence,
          })),
        }, component, action, scored);
      }

      if (runnerUp && best.score - runnerUp.score < 15) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "ambiguous",
          mapperReason: "runner_up_margin_too_small",
          strategy: null,
          value: null,
          confidence: best.score,
          attempts: scored.slice(0, 3).map((result) => ({
            ...result.candidate.summary,
            score: result.score,
            evidence: result.evidence,
          })),
        }, component, action, scored);
      }

      return this.mapperResolutionFromCandidate(
        best.candidate,
        best.candidate.bestLocator || component.primaryLocator,
        "resolved_with_fallback",
        "fingerprint_unique",
        best.score,
        component,
        scored,
      );
    }

    enumerateMapperCandidates(action = "", options = {}) {
      const maxComponents = this.normalizeMapperMaxComponents(options.maxComponents);
      const workBudget = options.workBudget || this.createMapperWorkBudget(
        options.maxRuntimeWork,
        DEFAULT_MAPPER_RUNTIME_WORK,
        MAX_MAPPER_RUNTIME_WORK,
      );
      const factWorkBudget = options.factWorkBudget || this.createMapperFactWorkBudget({
        maxComponents,
        maxFactWork: options.maxFactWork,
      });
      const selector = this.getMapperStaticCandidateSelector();
      const enumeration = this.enumerateBoundedMapperElements({
        maxComponents,
        includeHidden: options.includeHidden,
        workBudget,
        matches: (element) => element.matches?.(selector) === true,
      });
      if (enumeration.overflow) {
        return {
          candidates: [],
          ...enumeration,
        };
      }
      const candidates = [];
      for (const element of enumeration.elements) {
        const candidate = this.mapperCandidateFromElement(
          element,
          action,
          null,
          "live_candidate",
          { workBudget: factWorkBudget },
        );
        if (factWorkBudget.overflow) {
          return {
            candidates: [],
            ...enumeration,
            overflow: true,
            overflowKind: "runtime_fact_work_budget",
            factWorkCount: factWorkBudget.workCount,
            maxFactWork: factWorkBudget.maxWork,
            factWorkOverflowAt: factWorkBudget.overflowAt || "",
          };
        }
        if (candidate && this.mapperActionCompatible(candidate.fact.expectedCapabilities, action) &&
            this.mapperMappingLayersCompatible(options.component, candidate.fact) &&
            this.mapperPlatformScopesCompatible(
              options.component?.fingerprint?.structural?.platformScope,
              candidate.fact?.fingerprint?.structural?.platformScope,
            )) {
          candidates.push(candidate);
        }
      }
      return {
        candidates,
        overflow: false,
        candidateCount: enumeration.candidateCount,
        maxComponents: enumeration.maxComponents || maxComponents,
      };
    }

    mapperComponentScanOverflowResolution(component = {}, action = "", diagnostics = {}) {
      const maxComponents = this.normalizeMapperMaxComponents(diagnostics.maxComponents);
      const componentLimitOverflow = diagnostics.overflowKind === "component_limit" ||
        diagnostics.candidateLimitExceeded === true;
      const scanDiagnostics = {
        version: "mapper.scan.v1",
        maxComponents,
        sampledComponentCount: 0,
        candidateCount: Math.max(
          Number(diagnostics.candidateCount || 0),
          componentLimitOverflow
            ? maxComponents + MAPPER_SCAN_OVERFLOW_SENTINEL
            : 0,
        ),
        candidateCountIsLowerBound: true,
        overflow: true,
        reason: "component_scan_overflow",
        overflowKind: diagnostics.overflowKind || "component_limit",
        visitedNodeCount: Number(diagnostics.visitedNodeCount || 0),
        maxVisitedNodes: Number(diagnostics.maxVisitedNodes || 0),
        workCount: Number(diagnostics.workBudget?.workCount || diagnostics.workCount || 0),
        maxWork: Number(diagnostics.workBudget?.maxWork || diagnostics.maxWork || 0),
        factWorkCount: Number(diagnostics.factWorkCount || 0),
        maxFactWork: Number(diagnostics.maxFactWork || 0),
        overflowAt: String(
          diagnostics.factWorkOverflowAt ||
          diagnostics.workBudget?.overflowAt ||
          diagnostics.overflowAt ||
          "",
        ),
      };
      return this.withMapperResolverLog({
        element: null,
        mode: "mapper",
        mapperState: "protected_unsupported",
        mapperReason: "component_scan_overflow",
        strategy: null,
        value: null,
        confidence: 0,
        attempts: [],
        scanDiagnostics,
      }, component, action, []);
    }

    mapperCandidateFromElement(element, action = "", preferredLocator = null, source = "live_candidate", options = {}) {
      const workBudget = options.workBudget || null;
      const ctrlHash = this.getOrCreateControlHash(element, { workBudget });
      const targetInfo = resolver.buildElementTarget(element, ctrlHash, { workBudget });
      if (workBudget?.overflow) return null;
      const fact = this.buildMapperComponentFact(element, action, targetInfo, {
        workBudget,
      });
      if (workBudget?.overflow) return null;
      const locators = this.mergeMapperLocators(fact.locatorCandidates || [], preferredLocator);
      const visible = this.isVisibleElement(element);
      return {
        element,
        visible,
        fact: {
          ...fact,
          locatorCandidates: locators,
        },
        locators,
        bestLocator: preferredLocator || targetInfo.primary || null,
        summary: {
          source,
          componentId: fact.componentId,
          componentUid: fact.componentUid,
          displayName: fact.displayName,
          action: fact.action,
          primary: preferredLocator || targetInfo.primary || null,
          locatorCandidates: locators,
          fingerprint: fact.fingerprint || {},
          expectedCapabilities: fact.expectedCapabilities || [],
          mapperFact: {
            componentId: fact.componentId,
            componentUid: fact.componentUid,
            mappingLayer: fact.mappingLayer,
            displayName: fact.displayName,
            action: fact.action,
            locatorCandidates: locators,
            fingerprint: fact.fingerprint || {},
            expectedCapabilities: fact.expectedCapabilities || [],
          },
          visible,
          hidden: !visible,
        },
      };
    }

    mergeMapperLocators(locators = [], preferredLocator = null) {
      const merged = Array.isArray(locators) ? [...locators] : [];
      if (!preferredLocator?.strategy || !preferredLocator?.value) return merged;

      const hasPreferred = merged.some((locator) => {
        return locator.strategy === preferredLocator.strategy &&
          locator.value === preferredLocator.value;
      });
      if (hasPreferred) return merged;

      return [{
        strategy: preferredLocator.strategy,
        value: preferredLocator.value,
        reliability: Number(preferredLocator.score || preferredLocator.reliability || 100),
        selectedAtCapture: true,
      }, ...merged];
    }

    resolveStoredMapperLocatorTarget(component = {}, action = "", options = {}) {
      const fallbackLocators = Array.isArray(component.fallbackLocators)
        ? component.fallbackLocators
        : [];
      const suppliedLocatorCount = (component.primaryLocator ? 1 : 0) +
        fallbackLocators.length;
      if (suppliedLocatorCount > MAX_MAPPER_RUNTIME_LOCATORS) {
        return this.mapperComponentScanOverflowResolution(component, action, {
          maxComponents: options.maxComponents,
          overflow: true,
          overflowKind: "runtime_locator_budget",
          candidateCount: suppliedLocatorCount,
          maxWork: MAX_MAPPER_RUNTIME_LOCATORS,
          overflowAt: "runtime_locator_budget",
        });
      }
      const locators = [component.primaryLocator, ...fallbackLocators]
        .filter((locator) => locator?.strategy && locator?.value);
      let firstAmbiguous = null;

      for (let index = 0; index < locators.length; index += 1) {
        const locator = locators[index];
        const enumeration = this.findElementsByMapperLocator(locator, options);
        if (enumeration.overflow) {
          return this.mapperComponentScanOverflowResolution(
            component,
            action,
            enumeration,
          );
        }
        const candidates = enumeration.elements
          .map((element) => this.mapperCandidateFromElement(
            element,
            action,
            locator,
            "stored_locator_candidate",
            { workBudget: options.factWorkBudget },
          ))
          .filter(Boolean)
          .filter((candidate) => {
            return this.mapperActionCompatible(candidate.fact.expectedCapabilities, action) &&
              this.mapperPlatformScopesCompatible(
                component.fingerprint?.structural?.platformScope,
                candidate.fact?.fingerprint?.structural?.platformScope,
              );
          });
        if (options.factWorkBudget?.overflow) {
          return this.mapperComponentScanOverflowResolution(component, action, {
            ...enumeration,
            overflow: true,
            overflowKind: "runtime_fact_work_budget",
            factWorkCount: options.factWorkBudget.workCount,
            maxFactWork: options.factWorkBudget.maxWork,
            factWorkOverflowAt: options.factWorkBudget.overflowAt || "",
          });
        }

        if (candidates.length === 1) {
          const isPrimary = index === 0;
          return this.mapperResolutionFromCandidate(
            candidates[0],
            locator,
            isPrimary ? "resolved" : "resolved_with_fallback",
            isPrimary ? "stored_primary_locator_unique" : "stored_fallback_locator_unique",
            100,
            component,
            [{
              candidate: candidates[0],
              score: 100,
              evidence: [isPrimary ? "primary_locator" : "fallback_locator"],
            }],
          );
        }

        if (candidates.length > 1 && !firstAmbiguous) {
          firstAmbiguous = {
            locator,
            candidates,
            evidence: index === 0 ? "primary_locator" : "fallback_locator",
            reason: index === 0
              ? "stored_primary_locator_ambiguous"
              : "stored_fallback_locator_ambiguous",
          };
        }
      }

      if (!firstAmbiguous) return null;

      return this.withMapperResolverLog({
        element: null,
        mode: "mapper",
        mapperState: "ambiguous",
        mapperReason: firstAmbiguous.reason,
        strategy: firstAmbiguous.locator.strategy,
        value: firstAmbiguous.locator.value,
        confidence: 0,
        attempts: firstAmbiguous.candidates.map((candidate) => candidate.summary),
      }, component, action, firstAmbiguous.candidates.map((candidate) => ({
        candidate,
        score: 100,
        evidence: [firstAmbiguous.evidence],
      })));
    }

    findElementsByMapperLocator(locator = {}, options = {}) {
      const strategy = String(locator.strategy || "");
      const value = String(locator.value || "").trim();
      const maxComponents = this.normalizeMapperMaxComponents(options.maxComponents);
      if (!strategy || !value) {
        return {
          elements: [],
          roots: [],
          overflow: false,
          candidateCount: 0,
          maxComponents,
        };
      }

      if (strategy === "text") {
        return this.findMapperElementsByText(value, {
          ...options,
          maxComponents,
        });
      }

      const matches = this.createMapperLocatorMatcher(strategy, value, options);
      if (!matches) {
        return {
          elements: [],
          roots: [],
          overflow: false,
          candidateCount: 0,
          maxComponents,
        };
      }
      return this.enumerateBoundedMapperElements({
        maxComponents,
        includeHidden: options.includeHidden,
        workBudget: options.workBudget,
        matches,
      });
    }

    createMapperLocatorMatcher(strategy = "", value = "", options = {}) {
      let selector = "";
      switch (strategy) {
        case "id":
          selector = `#${this.cssEscapeIdentifier(value)}`;
          break;
        case "name":
          selector = `[name="${this.cssEscapeString(value)}"]`;
          break;
        case "ariaLabel":
          selector = `[aria-label="${this.cssEscapeString(value)}"]`;
          break;
        case "data-testid":
        case "data-test":
        case "data-qa":
        case "data-cy":
        case "data-automation-id":
        case "data-component":
          selector = `[${strategy}="${this.cssEscapeString(value)}"]`;
          break;
        case "css_selector":
          selector = value;
          break;
        case "ctrlHash":
        case "fallback_hash":
          selector = `[data-brunner-id="${this.cssEscapeString(value)}"],` +
            `[data-brunner-fallback="${this.cssEscapeString(value)}"]`;
          break;
        case "placeholder":
          selector = `[placeholder="${this.cssEscapeString(value)}"]`;
          break;
        case "title":
          selector = `[title="${this.cssEscapeString(value)}"]`;
          break;
        case "labelText": {
          const expected = this.normalizeMapperText(value);
          return (element) => {
            return this.withMapperFactWorkBudget(options.factWorkBudget, () => {
              return this.normalizeMapperText(this.getAssociatedLabelText(element)) === expected;
            });
          };
        }
        case "role_text": {
          const [role, ...textParts] = String(value).split("::");
          const expectedText = this.normalizeMapperText(textParts.join("::"));
          if (!role || !expectedText) return null;
          return (element) => {
            return element.getAttribute?.("role") === role &&
              this.normalizeMapperText(resolver.getStableElementText(element, {
                workBudget: options.factWorkBudget,
              })) === expectedText;
          };
        }
        case "form_context":
          selector = String(value).replace(/::text\(.*\)$/i, "");
          break;
        case "dom_path":
          return (element) => this.withMapperFactWorkBudget(
            options.factWorkBudget,
            () => this.getMapperDomPath(element) === value,
          );
        default:
          return null;
      }

      if (!selector) return null;
      try {
        document.documentElement?.matches?.(selector);
      } catch {
        return null;
      }
      return (element) => element.matches?.(selector) === true;
    }

    queryAllMapperRoots(selector = "", options = {}) {
      if (!selector) {
        return { elements: [], overflow: false, candidateCount: 0 };
      }
      try {
        document.documentElement?.matches?.(selector);
      } catch {
        return { elements: [], overflow: false, candidateCount: 0 };
      }
      return this.enumerateBoundedMapperElements({
        maxComponents: options.maxComponents,
        maxVisitedNodes: options.maxVisitedNodes,
        includeHidden: options.includeHidden !== false,
        workBudget: options.workBudget,
        matches: (element) => element.matches?.(selector) === true,
      });
    }

    findMapperElementsByLabelText(value = "") {
      const expected = this.normalizeMapperText(value);
      const elements = [];
      const factWorkBudget = this.createMapperFactWorkBudget({ maxComponents: 2 });
      const previousBudget = this.activeMapperFactWorkBudget || null;
      this.activeMapperFactWorkBudget = factWorkBudget;
      try {
        const labels = this.queryAllMapperRoots("label", {
          maxComponents: this.mapperMaxComponents,
        });
        if (labels.overflow) return labels;
        for (const label of labels.elements) {
        const text = this.normalizeMapperText(resolver.getBoundedElementText(label, {
          workBudget: factWorkBudget,
          maxChars: 160,
        }));
        if (text !== expected) continue;

        const forId = label.getAttribute("for");
        if (forId) {
          const byFor = this.queryAllMapperRoots(`#${this.cssEscapeIdentifier(forId)}`);
          if (byFor.overflow) return byFor;
          elements.push(...byFor.elements);
        }

        const nested = this.findBoundedMapperDescendant(label, [
          "input",
          "textarea",
          "select",
          "button",
          "[role='button']",
          "[contenteditable='true']",
        ].join(","), "highlight_label_descendant");
        if (nested) elements.push(nested);
      }
      if (factWorkBudget.overflow) {
        return {
          elements: [],
          overflow: true,
          overflowKind: "highlight_fact_work_budget",
          candidateCount: elements.length,
        };
      }
      return {
        elements,
        overflow: false,
        candidateCount: elements.length,
      };
      } finally {
        this.activeMapperFactWorkBudget = previousBudget;
      }
    }

    findMapperElementsByText(value = "", options = {}) {
      const expected = this.normalizeMapperText(value);
      const selector = this.getMapperStaticCandidateSelector();
      return this.enumerateBoundedMapperElements({
        maxComponents: options.maxComponents,
        includeHidden: options.includeHidden,
        workBudget: options.workBudget,
        matches: (element) => {
          return element.matches?.(selector) &&
            this.normalizeMapperText(resolver.getStableElementText(element, {
              workBudget: options.factWorkBudget,
            })) === expected;
        },
      });
    }

    findMapperElementsByRoleText(value = "") {
      const [role, ...textParts] = String(value).split("::");
      const expectedText = this.normalizeMapperText(textParts.join("::"));
      if (!role || !expectedText) return [];

      const enumeration = this.queryAllMapperRoots(`[role="${this.cssEscapeString(role)}"]`);
      if (enumeration.overflow) return enumeration;
      const elements = enumeration.elements.filter((element) => {
          return this.normalizeMapperText(resolver.getStableElementText(element)) === expectedText;
        });
      return { ...enumeration, elements, candidateCount: elements.length };
    }

    findMapperElementsByFormContext(value = "") {
      const selector = String(value).replace(/::text\(.*\)$/i, "");
      return this.queryAllMapperRoots(selector);
    }

    findMapperElementsByDomPath(value = "") {
      const factWorkBudget = this.createMapperFactWorkBudget({
        maxComponents: 2,
      });
      const enumeration = this.enumerateBoundedMapperElements({
        maxComponents: 2,
        includeHidden: true,
        matches: (element) => {
          const previousBudget = this.activeMapperFactWorkBudget || null;
          this.activeMapperFactWorkBudget = factWorkBudget;
          try {
            return this.getMapperDomPath(element) === value;
          } finally {
            this.activeMapperFactWorkBudget = previousBudget;
          }
        },
      });
      if (!factWorkBudget.overflow) return enumeration;
      return {
        ...enumeration,
        elements: [],
        overflow: true,
        overflowKind: "highlight_fact_work_budget",
        factWorkCount: factWorkBudget.workCount,
        maxFactWork: factWorkBudget.maxWork,
        overflowAt: factWorkBudget.overflowAt || "",
      };
    }

    getMapperDomPath(element) {
      if (!element || !(element instanceof Element)) return "";

      const segments = [];
      let current = element;
      while (current && current instanceof Element) {
        if (!this.consumeMapperFactWork("fact_dom_path_root")) return "";
        const root = current.getRootNode();
        const pathWithinRoot = this.getMapperPathWithinRoot(current, root);
        if (!pathWithinRoot) return "";
        segments.unshift(pathWithinRoot);
        if (!(root instanceof ShadowRoot) || !root.host) break;
        current = root.host;
      }

      return segments.filter(Boolean).join("::shadow::");
    }

    getMapperShadowPath(element) {
      if (!element || !(element instanceof Element)) return [];
      const boundaries = [];
      let current = element;
      while (current && current instanceof Element) {
        if (!this.consumeMapperFactWork("fact_shadow_path_root")) return [];
        const root = current.getRootNode();
        if (!(root instanceof ShadowRoot) || !root.host) break;
        const hostPath = this.getMapperPathWithinRoot(
          root.host,
          root.host.getRootNode(),
        );
        const innerPath = this.getMapperPathWithinRoot(current, root);
        if (!hostPath || !innerPath) return [];
        boundaries.unshift({
          hostPath,
          innerPath,
        });
        current = root.host;
      }
      return boundaries;
    }

    getMapperPathWithinRoot(element, root) {
      const parts = [];
      let current = element;
      while (current?.nodeType === Node.ELEMENT_NODE) {
        if (!this.consumeMapperFactWork("fact_dom_path_ancestor")) return "";
        const parent = current.parentElement;
        const tag = current.tagName.toLowerCase();
        if (!parent) {
          if (current !== root?.documentElement) parts.unshift(`${tag}:0`);
          break;
        }
        const index = this.getBoundedMapperSiblingIndex(current, "fact_dom_path_sibling");
        if (index < 0) return "";
        parts.unshift(`${tag}:${index}`);
        current = parent;
        if (current === root?.documentElement) break;
      }
      return parts.join("/");
    }

    cssEscapeIdentifier(value) {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
      }

      return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }

    cssEscapeString(value) {
      return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    mapperResolutionFromCandidate(candidate, locator, state, reason, confidence, component = null, scored = null) {
      const result = {
        element: candidate.element,
        mode: "mapper",
        mapperState: state,
        mapperReason: reason,
        strategy: locator?.strategy || "mapper_fingerprint",
        value: locator?.value || candidate.fact.componentId,
        confidence,
        attempts: [candidate.summary],
      };
      return this.withMapperResolverLog(result, component, candidate.fact?.action || "", scored || [{
        candidate,
        score: confidence,
        evidence: state === "resolved" ? ["primary_locator"] : [],
      }]);
    }

    withMapperResolverLog(result = {}, component = null, action = "", scored = []) {
      const attempts = Array.isArray(result.attempts) ? result.attempts : [];
      const ranked = (Array.isArray(scored) ? scored : [])
        .slice(0, 5)
        .map((item, index) => ({
          rank: index + 1,
          score: Number(item.score) || 0,
          evidence: Array.isArray(item.evidence) ? item.evidence : [],
          componentId: item.candidate?.summary?.componentId || "",
          componentUid: item.candidate?.summary?.componentUid || "",
          displayName: item.candidate?.summary?.displayName || "",
          primary: item.candidate?.summary?.primary || null,
        }));
      const best = ranked[0] || null;
      const runnerUp = ranked[1] || null;
      return {
        ...result,
        resolverLog: {
          version: "mapper.resolver.log.v1",
          createdAt: new Date().toISOString(),
          action: String(action || component?.action || ""),
          componentId: String(component?.componentId || ""),
          componentUid: String(component?.componentUid || ""),
          state: result.mapperState || "",
          reason: result.mapperReason || "",
          confidence: Number(result.confidence) || 0,
          strategy: result.strategy || null,
          value: result.value || null,
          thresholds: {
            minimumScore: 75,
            minimumMargin: 15,
          },
          selected: best,
          runnerUp,
          margin: best && runnerUp ? best.score - runnerUp.score : null,
          attemptCount: attempts.length,
          scanDiagnostics: result.scanDiagnostics || null,
          attempts,
          rankedCandidates: ranked,
        },
      };
    }

    mapperCandidateHasLocator(candidate, expected = {}) {
      if (!expected?.strategy || !expected?.value) return false;
      return candidate.locators.some((locator) => {
        return locator.strategy === expected.strategy &&
          locator.value === expected.value;
      });
    }

    scoreMapperCandidate(component = {}, candidate = {}) {
      return this.scoreMapperCandidateWithEvidence(component, candidate).score;
    }

    scoreMapperCandidateWithEvidence(component = {}, candidate = {}) {
      const expected = component.fingerprint || {};
      const actual = candidate.fact?.fingerprint || {};
      let score = 0;
      const evidence = [];

      if (!this.mapperMappingLayersCompatible(component, candidate.fact)) {
        return {
          score: 0,
          evidence: ["mapping_layer_contradiction"],
          disqualified: true,
          reason: "mapping_layer_mismatch",
        };
      }

      if (!this.mapperPlatformScopesCompatible(
        expected.structural?.platformScope,
        actual.structural?.platformScope,
      )) {
        return {
          score: 0,
          evidence: ["platform_scope_contradiction"],
          disqualified: true,
          reason: "platform_scope_mismatch",
        };
      }

      const expectedSemantic = expected.semantic || {};
      const actualSemantic = actual.semantic || {};
      if (expectedSemantic.role && expectedSemantic.role === actualSemantic.role) {
        score += 10;
        evidence.push("role");
      }
      if (expectedSemantic.inputType && expectedSemantic.inputType === actualSemantic.inputType) {
        score += 6;
        evidence.push("input_type");
      }

      const expectedName = this.normalizeMapperText(
        expectedSemantic.accessibleName ||
          expectedSemantic.altText ||
          expectedSemantic.labelText ||
          expectedSemantic.stableText ||
          expectedSemantic.placeholder,
      );
      const actualName = this.normalizeMapperText(
        actualSemantic.accessibleName ||
          actualSemantic.altText ||
          actualSemantic.labelText ||
          actualSemantic.stableText ||
          actualSemantic.placeholder,
      );
      if (expectedName && expectedName === actualName) {
        score += 29;
        evidence.push("exact_name");
      } else if (expectedName && actualName && this.mapperTextOverlap(expectedName, actualName) >= 0.5) {
        score += 12;
        evidence.push("partial_name");
      }

      const expectedStructural = this.mapperStructuralTokens(expected.structural);
      const actualStructural = this.mapperStructuralTokens(actual.structural);
      const structuralScore = Math.round(this.mapperSetOverlap(expectedStructural, actualStructural) * 30);
      score += structuralScore;
      if (structuralScore) evidence.push("structural");

      const locatorMatches = [
        component.primaryLocator,
        ...(component.fallbackLocators || []),
      ].filter(Boolean).filter((locator) => {
        return this.mapperCandidateHasLocator(candidate, locator);
      }).length;
      if (locatorMatches) {
        score += Math.min(15, locatorMatches * 8);
        evidence.push("locator");
      }

      const expectedCapabilities = expected.behavioral?.capabilities || component.expectedCapabilities || [];
      const actualCapabilities = actual.behavioral?.capabilities || candidate.fact?.expectedCapabilities || [];
      const capabilityScore = Math.round(this.mapperSetOverlap(expectedCapabilities, actualCapabilities) * 8);
      score += capabilityScore;
      if (capabilityScore) evidence.push("capabilities");

      return {
        score: Math.min(Math.round(score), 100),
        evidence,
        disqualified: false,
      };
    }

    mapperPlatformScopesCompatible(expected = {}, actual = {}) {
      const expectedFamily = this.toMapperIdentifier(expected?.family);
      if (!expectedFamily || expectedFamily === "generic") return true;

      if (this.toMapperIdentifier(actual?.family) !== expectedFamily) return false;
      if (this.toMapperIdentifier(actual?.region) !== this.toMapperIdentifier(expected?.region)) {
        return false;
      }

      for (const field of ["majorRegion", "threadId", "containerId", "repeatedKind"]) {
        const expectedValue = this.toMapperIdentifier(expected?.[field]);
        if (expectedValue && this.toMapperIdentifier(actual?.[field]) !== expectedValue) {
          return false;
        }
      }

      return true;
    }

    mapperMappingLayersCompatible(expected = {}, actual = {}) {
      return this.mapperRecordLayer(expected) === this.mapperRecordLayer(actual);
    }

    mapperRecordLayer(record = {}) {
      if (record?.mappingLayer === "dynamic") return "dynamic";
      const fingerprint = record?.fingerprint || record || {};
      return this.getMapperMappingLayer(fingerprint);
    }

    mapperActionCompatible(capabilities = [], action = "") {
      const capabilitySet = new Set(capabilities || []);
      if (action.includes("click") || action.includes("hover")) return capabilitySet.has("click");
      if (action.includes("type") || action.includes("clear")) return capabilitySet.has("type") || capabilitySet.has("clear");
      if (action.includes("select")) return capabilitySet.has("select");
      if (action.includes("toggle")) return capabilitySet.has("click") || capabilitySet.has("toggle");
      if (action.includes("upload")) return capabilitySet.has("upload");
      if (action.includes("extract") || action.startsWith("wait.element.")) return capabilitySet.has("extract") || capabilitySet.size > 0;
      return true;
    }

    mapperPlatformScopeAllowsAction(scope = {}, action = "") {
      if (scope.mappingDisposition === "unsupported_scope") return false;
      if (scope.mappingDisposition !== "context_only") return true;
      return action.includes("extract") || action.startsWith("wait.element.");
    }

    mapperStructuralTokens(structural = {}) {
      return [
        ...(Array.isArray(structural.ancestorTokens) ? structural.ancestorTokens : []),
        structural.formName,
        structural.nearbyLabel,
      ].map((value) => this.normalizeMapperText(value)).filter(Boolean);
    }

    mapperSetOverlap(a = [], b = []) {
      const aSet = new Set((a || []).map((value) => this.normalizeMapperText(value)).filter(Boolean));
      const bSet = new Set((b || []).map((value) => this.normalizeMapperText(value)).filter(Boolean));
      if (!aSet.size || !bSet.size) return 0;
      let overlap = 0;
      for (const item of aSet) {
        if (bSet.has(item)) overlap += 1;
      }
      return overlap / Math.max(aSet.size, bSet.size);
    }

    mapperTextOverlap(a = "", b = "") {
      return this.mapperSetOverlap(
        String(a).split(/\s+/).filter((word) => word.length > 2),
        String(b).split(/\s+/).filter((word) => word.length > 2),
      );
    }

    normalizeMapperText(value) {
      return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    }

    stepTextValue(step = {}) {
      return String(step.config?.value ?? step.value ?? step.text ?? "");
    }

    stepOptionValue(step = {}) {
      return String(step.config?.value ?? step.value ?? step.option ?? step.text ?? "");
    }

    stepToggleValue(step = {}) {
      return step.config?.value ?? step.value;
    }

    normalizeHostCoordinateConfidence(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return 0;
      if (numeric <= 1) return numeric;
      return Math.max(0, Math.min(1, numeric / 100));
    }

    async focusHostFallbackTypeTarget(element) {
      const tag = String(element?.tagName || "").toLowerCase();
      const isEditableTarget = Boolean(
        element instanceof Element &&
          (
            tag === "textarea" ||
            (tag === "input" && this.isTextEntryElement(element)) ||
            element.isContentEditable
          ),
      );
      if (!isEditableTarget || typeof element.focus !== "function") {
        return {
          ok: false,
          error: "Host fallback typing requires a resolved editable input.",
          reason: "host_fallback_type_target_not_editable",
          activeElement: this.getDeepActiveElement(),
        };
      }

      try {
        element.focus({ preventScroll: true });
      } catch {
        return {
          ok: false,
          error: "Host fallback typing target could not be focused.",
          reason: "host_fallback_type_focus_failed",
          activeElement: this.getDeepActiveElement(),
        };
      }

      await this.delay(0);
      const activeElement = this.getDeepActiveElement();
      if (!this.isElementOrComposedDescendant(element, activeElement)) {
        return {
          ok: false,
          error: "Host fallback typing target did not retain focus.",
          reason: "host_fallback_type_focus_failed",
          activeElement,
        };
      }

      return {
        ok: true,
        activeElement,
      };
    }

    getDeepActiveElement() {
      let activeElement = document.activeElement || null;
      const visited = new Set();
      while (
        activeElement &&
        !visited.has(activeElement) &&
        activeElement.shadowRoot?.activeElement
      ) {
        visited.add(activeElement);
        activeElement = activeElement.shadowRoot.activeElement;
      }
      return activeElement;
    }

    isElementOrComposedDescendant(container, candidate) {
      let current = candidate || null;
      const visited = new Set();
      while (current && !visited.has(current)) {
        if (current === container) return true;
        visited.add(current);
        current = current.parentElement || current.getRootNode?.()?.host || null;
      }
      return false;
    }

    assertPostActionVerification(step = {}, resolved = {}) {
      const config = step.config || {};
      const expected = String(config.verificationText || "").trim();
      if (!expected) return;

      const selector = String(config.verificationSelector || "").trim();
      let verificationElement = null;

      if (selector) {
        try {
          verificationElement = document.querySelector(selector);
        } catch {
          verificationElement = null;
        }
      } else {
        verificationElement = resolved.element || null;
      }

      const actual = this.extractVerificationText(verificationElement);

      if (actual.includes(expected)) return;

      const error = new Error("Post-action verification failed.");
      error.diagnostics = {
        ...this.createExecutionDiagnostics(
          step,
          resolved,
          "post_action_verification_failed",
        ),
        verificationSelector: selector,
        expectedText: expected,
        actualText: actual,
      };
      throw error;
    }

    extractVerificationText(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return String(element.innerText || element.textContent || "");
      }

      if (["INPUT", "TEXTAREA"].includes(element.tagName)) {
        if (element.type === "checkbox" || element.type === "radio") {
          return String(element.checked);
        }
        return String(element.value || "");
      }

      if (element.tagName === "SELECT") {
        const selectedText = element.selectedOptions?.[0]?.textContent || "";
        return `${element.value || ""} ${selectedText}`.trim();
      }

      return String(
        element.innerText ??
          element.textContent ??
          ("value" in element ? element.value : "") ??
          "",
      );
    }

    createExecutionDiagnostics(step, resolved, finalReason) {
      return {
        action: step?.action || step?.type || "unknown",
        expectedPage: step?.page || null,
        actualPage: this.getCurrentPageContext(),
        targetResolution: {
          mode: resolved?.mode || "failed",
          mapperState: resolved?.mapperState || "",
          mapperReason: resolved?.mapperReason || "",
          strategy: resolved?.strategy || null,
          value: resolved?.value || null,
          confidence: resolved?.confidence || 0,
          attempts: Array.isArray(resolved?.attempts)
            ? resolved.attempts
            : [],
          resolverLog: resolved?.resolverLog || null,
          scanDiagnostics: resolved?.scanDiagnostics ||
            resolved?.resolverLog?.scanDiagnostics ||
            null,
          mapperResolution: this.createMapperRuntimeResolutionOutcome(
            step,
            resolved,
            finalReason,
          ),
          controlsTreeAttempted: Boolean(resolved?.controlsTreeAttempted),
          fuzzyAttempted: Boolean(resolved?.fuzzyAttempted),
        },
        finalReason,
      };
    }

    withMapperRuntimeResolution(payload = {}, step = {}, resolved = {}) {
      const mapperResolution = this.createMapperRuntimeResolutionOutcome(step, resolved, "");
      return mapperResolution
        ? {
            ...payload,
            mapperResolution,
          }
        : payload;
    }

    createMapperRuntimeResolutionOutcome(step = {}, resolved = {}, finalReason = "") {
      if (!resolved?.mapperState && !step?.mapperContext?.component) return null;
      const log = resolved.resolverLog || {};
      const componentRef = step.componentRef || {};
      const pageMap = step.mapperContext?.pageMap || {};
      return {
        version: "mapper.runtime_resolution.v1",
        action: step.action || step.type || log.action || "",
        componentId: componentRef.componentId || log.componentId || "",
        componentUid: componentRef.componentUid || log.componentUid || "",
        pageProfileKey: componentRef.pageProfileKey || pageMap.pageProfileKey || "",
        mapVersionId: pageMap.mapVersionId || componentRef.capturedMapVersionId || "",
        state: resolved.mapperState || log.state || "",
        reason: resolved.mapperReason || log.reason || "",
        finalReason,
        confidence: Number(resolved.confidence || log.confidence || 0),
        margin: Number.isFinite(Number(log.margin)) ? Number(log.margin) : null,
        attemptCount: Number(log.attemptCount || 0),
        scanDiagnostics: resolved.scanDiagnostics || log.scanDiagnostics || null,
        evidence: Array.isArray(log.selected?.evidence) ? log.selected.evidence : [],
        selected: this.normalizeMapperRuntimeCandidate(log.selected),
        runnerUp: this.normalizeMapperRuntimeCandidate(log.runnerUp),
      };
    }

    normalizeMapperRuntimeCandidate(candidate = null) {
      if (!candidate || typeof candidate !== "object") return null;
      return {
        rank: Number(candidate.rank || 0),
        score: Number(candidate.score || 0),
        evidence: Array.isArray(candidate.evidence) ? candidate.evidence : [],
        componentId: candidate.componentId || "",
        componentUid: candidate.componentUid || "",
        displayName: candidate.displayName || "",
        primary: candidate.primary ? { ...candidate.primary } : null,
      };
    }

    async executeClick(element) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      for (const type of [
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ]) {
        element.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
          }),
        );
      }

      element.click?.();

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    async executeType(element, value) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      if (element.isContentEditable) {
        element.textContent = value;
      } else if ("value" in element) {
        element.value = value;
      } else {
        element.textContent = value;
      }

      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value,
        }),
      );

      element.dispatchEvent(
        new Event("change", {
          bubbles: true,
          cancelable: true,
        }),
      );

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    async executeFocus(element) {
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      element.dispatchEvent(
        new FocusEvent("focus", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }

    async executeSelect(element, value) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      const desiredValue = String(value || "").trim();

      if (element.tagName.toLowerCase() === "select") {
        const options = Array.from(element.options);

        const match = options.find((option) => {
          return (
            option.value === desiredValue ||
            option.text.trim() === desiredValue ||
            option.label.trim() === desiredValue
          );
        });

        if (!match) {
          throw new Error(`Select option not found: ${desiredValue}`);
        }

        element.value = match.value;

        element.dispatchEvent(
          new Event("input", {
            bubbles: true,
            cancelable: true,
          }),
        );

        element.dispatchEvent(
          new Event("change", {
            bubbles: true,
            cancelable: true,
          }),
        );

        window.setTimeout(() => {
          delete element.dataset.brunnerSuppressRecord;
        }, 250);

        return;
      }

      // Basic ARIA/custom dropdown fallback.
      await this.executeClick(element);
      await this.delay(150);

      const option = this.findVisibleOptionByText(desiredValue);

      if (!option) {
        throw new Error(`Visible option not found: ${desiredValue}`);
      }

      await this.executeClick(option);

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    async executeToggle(element, desiredState) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();

      const isCheckable =
        tag === "input" && ["checkbox", "radio"].includes(type);

      if (isCheckable) {
        const hasDesiredState = ![
          undefined,
          null,
          "",
        ].includes(desiredState);
        const desiredChecked = hasDesiredState
          ? [true, 1, "1", "true", "checked", "on"].includes(desiredState)
          : !element.checked;

        if (element.checked !== desiredChecked) {
          if (type === "radio" && !desiredChecked) {
            element.checked = false;
            element.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            element.click();
          }
        }

        element.dispatchEvent(
          new Event("change", {
            bubbles: true,
            cancelable: true,
          }),
        );

        window.setTimeout(() => {
          delete element.dataset.brunnerSuppressRecord;
        }, 250);

        return;
      }

      const ariaChecked = element.getAttribute("aria-checked");
      const ariaPressed = element.getAttribute("aria-pressed");

      if (ariaChecked !== null || ariaPressed !== null) {
        await this.executeClick(element);

        window.setTimeout(() => {
          delete element.dataset.brunnerSuppressRecord;
        }, 250);

        return;
      }

      await this.executeClick(element);

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    executeFileInputUpload(element, config) {
      if (!filePayload) {
        throw new Error("BRunner file payload helper is unavailable.");
      }

      if (
        element.tagName?.toLowerCase() !== "input" ||
        String(element.type || "").toLowerCase() !== "file"
      ) {
        throw new Error("File Input Upload target must be <input type=\"file\">.");
      }

      const payload = filePayload.buildFilePayload(config);
      const file = new File([payload.bytes], payload.filename, {
        type: payload.mimeType,
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);

      element.dataset.brunnerSuppressRecord = "true";
      element.files = transfer.files;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);

      return {
        name: file.name,
        type: file.type,
        size: file.size,
      };
    }

    findVisibleOptionByText(text) {
      const expected = String(text || "")
        .trim()
        .toLowerCase();

      if (!expected) return null;

      const candidates = Array.from(
        document.querySelectorAll(
          [
            "option",
            "[role='option']",
            "[role='menuitem']",
            "li",
            "div",
            "span",
            "button",
          ].join(","),
        ),
      );

      return (
        candidates.find((element) => {
          if (!this.isVisibleElement(element)) return false;

          const value = String(
            element.innerText ||
              element.textContent ||
              element.getAttribute("aria-label") ||
              "",
          )
            .trim()
            .toLowerCase();

          return value === expected;
        }) || null
      );
    }

    extractValue(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return element.innerText || element.textContent || "";
      }

      if ("value" in element) {
        return element.value || "";
      }

      return element.innerText || element.textContent || "";
    }

    async executeDoubleClick(element) {
      await this.executeClick(element);
      await this.delay(50);
      await this.executeClick(element);

      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          detail: 2,
        }),
      );
    }

    async executeHover(element) {
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await this.delay(50);

      if (!this.passesJitOcclusionCheck(element)) {
        throw new Error("Hover target is occluded or not interactable.");
      }

      const rect = element.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };

      element.dispatchEvent(new MouseEvent("pointerover", eventInit));
      element.dispatchEvent(new MouseEvent("mouseover", eventInit));
      element.dispatchEvent(new MouseEvent("mouseenter", eventInit));
      element.dispatchEvent(new MouseEvent("mousemove", eventInit));
    }

    isConditionalWaitAction(action) {
      return [
        Actions.WaitElementVisible,
        Actions.WaitElementHidden,
        Actions.WaitElementEnabled,
        Actions.WaitElementText,
        Actions.WaitUrl,
      ].includes(action);
    }

    async executeConditionalWait(step, runId = "") {
      const action = step.action || step.type;
      const timeoutMs = Number(step.config?.timeoutMs ?? 10000);
      const pollingMs = Number(step.config?.pollingMs ?? 250);

      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new Error("Wait timeout must be a non-negative number.");
      }

      if (!Number.isFinite(pollingMs) || pollingMs <= 0) {
        throw new Error("Wait polling interval must be greater than zero.");
      }

      if (
        action === Actions.WaitUrl &&
        !String(step.config?.expected || "").trim()
      ) {
        throw new Error("Wait for URL requires an expected value.");
      }

      if (
        action === Actions.WaitElementText &&
        !String(step.config?.expectedText || "").trim()
      ) {
        throw new Error("Wait for Text requires expected text.");
      }

      const startedAt = Date.now();
      let attempts = 0;

      while (Date.now() - startedAt <= timeoutMs) {
        this.throwIfExecutionCancelled(runId);
        attempts++;

        const waitResult = this.isWaitConditionSatisfied(action, step);
        if (waitResult?.mapperState) {
          return {
            ok: false,
            error: `Mapper could not resolve wait target: ${waitResult.mapperState}`,
            diagnostics: this.createExecutionDiagnostics(
              step,
              waitResult.resolved,
              `mapper_${waitResult.mapperState}`,
            ),
          };
        }

        if (waitResult === true || waitResult?.satisfied === true) {
          return {
            ok: true,
            attempts,
            elapsedMs: Date.now() - startedAt,
          };
        }

        await this.delayWithCancellation(
          Math.min(pollingMs, Math.max(timeoutMs, 1)),
          runId,
        );
      }

      const error = new Error(`Timed out waiting for ${action}.`);
      error.diagnostics = {
        action,
        expectedPage: step.page || null,
        actualPage: this.getCurrentPageContext(),
        attempts,
        timeoutMs,
        pollingMs,
        finalReason: "wait_condition_timeout",
      };
      throw error;
    }

    throwIfExecutionCancelled(runId) {
      if (!runId || !this.cancelledRunIds.has(runId)) return;

      const error = new Error("Workflow stopped by user.");
      error.name = "WorkflowCancelledError";
      error.diagnostics = {
        runId,
        finalReason: "workflow_cancelled",
      };
      throw error;
    }

    async delayWithCancellation(ms, runId) {
      let remaining = Math.max(Number(ms) || 0, 0);

      while (remaining > 0) {
        this.throwIfExecutionCancelled(runId);
        const chunk = Math.min(remaining, 100);
        await this.delay(chunk);
        remaining -= chunk;
      }

      this.throwIfExecutionCancelled(runId);
    }

    isWaitConditionSatisfied(action, step) {
      if (action === Actions.WaitUrl) {
        const expected = String(step.config?.expected || "");
        const mode = step.config?.matchMode || "contains";

        if (mode === "exact") return location.href === expected;
        if (mode === "regex") return new RegExp(expected).test(location.href);
        return location.href.includes(expected);
      }

      const resolved = this.resolveStepTarget(step, action);
      const element = resolved.element;

      if (!element && resolved.mapperState) {
        return {
          satisfied: false,
          mapperState: resolved.mapperState,
          mapperReason: resolved.mapperReason || "",
          resolved,
        };
      }

      if (action === Actions.WaitElementHidden) {
        return !element || !this.isVisibleElement(element);
      }
      if (!element) return false;
      if (action === Actions.WaitElementVisible) return this.isVisibleElement(element);
      if (action === Actions.WaitElementEnabled) {
        return (
          this.isVisibleElement(element) &&
          !element.disabled &&
          element.getAttribute("aria-disabled") !== "true"
        );
      }

      if (action === Actions.WaitElementText) {
        const expected = String(step.config?.expectedText || "");
        const actual = String(element.innerText || element.textContent || "");
        return actual.includes(expected);
      }

      return false;
    }

    extractTextValue(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return String(element.innerText || element.textContent || "").trim();
      }

      if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) {
        return String(element.value || "").trim();
      }

      return String(element.innerText || element.textContent || "").trim();
    }

    extractListValue(element, config) {
      const selector = String(config.itemSelector || "li").trim();
      const valueMode = config.valueMode || "text";
      const attributeName = String(config.attributeName || "href").trim();
      const items = Array.from(element.querySelectorAll(selector));

      return items.map((item) => {
        if (valueMode === "attribute") {
          return item.getAttribute(attributeName) ?? "";
        }

        return this.extractTextValue(item);
      });
    }

    extractTableValue(element, config) {
      const rowSelector = String(config.rowSelector || "tr").trim();
      const cellSelector = String(config.cellSelector || "th, td").trim();
      const rows = Array.from(element.querySelectorAll(rowSelector)).map(
        (row) => {
          return Array.from(row.querySelectorAll(cellSelector)).map((cell) => {
            return this.extractTextValue(cell);
          });
        },
      ).filter((row) => row.length > 0);

      if (rows.length === 0) {
        return {
          headers: [],
          rows: [],
        };
      }

      const firstRowElement = element.querySelector(rowSelector);
      const hasHeaderCells = Boolean(firstRowElement?.querySelector("th"));
      const headers = hasHeaderCells ? rows[0] : [];
      const dataRows = hasHeaderCells ? rows.slice(1) : rows;

      return {
        headers,
        rows: headers.length > 0
          ? dataRows.map((row) => {
              return Object.fromEntries(
                headers.map((header, index) => [header || `column_${index + 1}`, row[index] ?? ""]),
              );
            })
          : dataRows,
      };
    }

    extractPageValue(field) {
      const metadata = {
        title: document.title,
        url: location.href,
        origin: location.origin,
        hostname: location.hostname,
        path: location.pathname,
        search: location.search,
      };

      return field === "all" ? metadata : metadata[field] ?? "";
    }

    passesJitOcclusionCheck(element) {
      if (!this.isVisibleElement(element)) return false;

      const rect = element.getBoundingClientRect();

      const x = Math.min(
        Math.max(rect.left + rect.width / 2, 0),
        window.innerWidth - 1,
      );

      const y = Math.min(
        Math.max(rect.top + rect.height / 2, 0),
        window.innerHeight - 1,
      );

      const topElement = document.elementFromPoint(x, y);

      return (
        topElement === element ||
        element.contains(topElement) ||
        topElement?.contains(element)
      );
    }

    getOrCreateControlHash(element, options = {}) {
      if (!element.dataset.brunnerId) {
        element.dataset.brunnerId = this.createControlHash(element, options);
      }

      return element.dataset.brunnerId;
    }

    createControlHash(element, options = {}) {
      const previousBudget = this.activeMapperFactWorkBudget || null;
      this.activeMapperFactWorkBudget = options.workBudget || previousBudget;
      try {
      const basis = [
        element.tagName,
        element.id,
        element.getAttribute("name"),
        element.getAttribute("aria-label"),
        element.getAttribute("type"),
        resolver.getStableElementText(element, {
          workBudget: this.activeMapperFactWorkBudget,
        }),
        this.getDomIndexPath(element),
      ].join("|");

      return `ctrl_${this.hashString(basis)}`;
      } finally {
        this.activeMapperFactWorkBudget = previousBudget;
      }
    }

    getDomIndexPath(element) {
      return this.getMapperDomPath(element);
    }

    hashString(value) {
      let hash = 0;
      const text = String(value);

      for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
      }

      return Math.abs(hash).toString(16);
    }

    getFriendlyName(element, targetInfo, options = {}) {
      const primary = targetInfo?.primary;

      if (primary?.value) {
        return `${primary.strategy}: ${primary.value}`;
      }

      const text = resolver.getStableElementText(element, options);
      if (text) return text;

      const aria = element.getAttribute("aria-label");
      if (aria) return aria;

      const placeholder = element.getAttribute("placeholder");
      if (placeholder) return placeholder;

      const tag = element.tagName?.toLowerCase?.() || "element";
      return tag;
    }

    findRecordableElement(startElement) {
      if (!startElement || !(startElement instanceof Element)) return null;

      return startElement.closest(
        [
          "button",
          "a",
          "input",
          "textarea",
          "select",
          "img",
          "picture",
          "svg",
          "canvas",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "p",
          "label",
          "li",
        "td",
        "th",
        "span",
        "pre",
        "output",
          "[role='button']",
          "[role='link']",
          "[role='textbox']",
          "[role='img']",
          "[role='heading']",
          "[role='status']",
          "[role='log']",
          "[contenteditable='true']",
        ].join(","),
      );
    }

    isUsableControl(element, options = {}) {
      if (!this.isVisibleElement(element)) return false;
      if (element.disabled) return false;
      if (element.getAttribute("aria-hidden") === "true") return false;
      if (this.isPassiveTextCandidate(element)) {
        return this.hasMappableText(element, options);
      }
      if (this.isVisualMediaCandidate(element)) {
        return this.hasMappableMediaSignal(element, options);
      }
      return true;
    }

    isPassiveTextCandidate(element) {
      const tag = element?.tagName?.toLowerCase?.() || "";
      const role = (element?.getAttribute?.("role") || "").toLowerCase();
      return [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "label",
        "li",
        "td",
        "th",
        "span",
        "pre",
        "output",
      ].includes(tag) || ["heading", "status", "log"].includes(role);
    }

    isVisualMediaCandidate(element) {
      const tag = element?.tagName?.toLowerCase?.() || "";
      const role = (element?.getAttribute?.("role") || "").toLowerCase();
      return ["img", "picture", "svg", "canvas"].includes(tag) || role === "img";
    }

    hasMappableText(element, options = {}) {
      if (this.hasInteractiveAncestor(element, options)) return false;
      const text = this.cleanMapperText(resolver.getBoundedElementText(element, {
        workBudget: options.workBudget,
        maxChars: 181,
      }));
      if (text.length < 2 || text.length > 180) return false;
      return !this.hasNestedMappableText(element, options);
    }

    hasMappableMediaSignal(element, options = {}) {
      if (this.hasInteractiveAncestor(element, options)) return false;
      const tag = element.tagName?.toLowerCase?.() || "";
      if (tag === "canvas") return true;
      return Boolean(
        element.getAttribute("alt") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("src") ||
          this.cleanMapperText(resolver.getBoundedElementText(element, {
            workBudget: options.workBudget,
            maxChars: 181,
          })),
      );
    }

    hasInteractiveAncestor(element, options = {}) {
      const selector = [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='link']",
        "[role='textbox']",
        "[contenteditable='true']",
      ].join(",");
      let current = element?.parentElement || null;
      while (current) {
        if (options.workBudget && !options.workBudget.consume("candidate_interactive_ancestor")) {
          return false;
        }
        if (current.matches?.(selector)) return true;
        current = current.parentElement;
      }
      return false;
    }

    hasNestedMappableText(element, options = {}) {
      let walker;
      try {
        walker = (element.ownerDocument || document).createTreeWalker(
          element,
          NodeFilter.SHOW_ELEMENT,
        );
      } catch {
        return false;
      }
      let child = walker.nextNode();
      while (child) {
        if (options.workBudget && !options.workBudget.consume("candidate_text_descendant")) {
          return false;
        }
        if (
          this.isVisibleElement(child) &&
          this.isPassiveTextCandidate(child) &&
          !this.hasInteractiveAncestor(child, options)
        ) {
          const text = this.cleanMapperText(resolver.getBoundedElementText(child, {
            workBudget: options.workBudget,
            maxChars: 181,
          }));
          if (text.length >= 2 && text.length <= 180) return true;
        }
        child = walker.nextNode();
      }
      return false;
    }

    isPointerClickableElement(element) {
      if (!element || !(element instanceof Element)) return false;
      if (typeof element.onclick === "function") return true;
      const role = (element.getAttribute("role") || "").toLowerCase();
      if (["button", "link", "menuitem", "tab", "checkbox", "radio"].includes(role)) return true;
      return window.getComputedStyle(element).cursor === "pointer";
    }

    isVisibleElement(element) {
      if (!element || !(element instanceof Element)) return false;

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }

    isTextEntryElement(element) {
      if (!element || !(element instanceof Element)) return false;

      const tag = element.tagName.toLowerCase();

      if (tag === "textarea") return true;
      if (tag === "select") return true;
      if (element.isContentEditable) return true;

      if (tag === "input") {
        const type = (element.getAttribute("type") || "text").toLowerCase();

        return ![
          "button",
          "submit",
          "reset",
          "checkbox",
          "radio",
          "file",
          "image",
          "hidden",
        ].includes(type);
      }

      return false;
    }

    getElementValue(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return element.innerText || element.textContent || "";
      }

      if ("value" in element) {
        return element.value || "";
      }

      return "";
    }

    getSelectedOptionText(element) {
      if (!element || element.tagName?.toLowerCase?.() !== "select") return "";
      const option = element.selectedOptions?.[0] ||
        element.options?.[element.selectedIndex] ||
        null;
      return String(option?.text || option?.label || "").trim();
    }

    delay(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    getCurrentPageContext() {
      let pageWindow = window;
      if (window !== window.top) {
        try {
          void window.top.location.href;
          pageWindow = window.top;
        } catch {
          pageWindow = window;
        }
      }
      return {
        url: pageWindow.location.href,
        origin: pageWindow.location.origin,
        host: pageWindow.location.host,
        hostname: pageWindow.location.hostname,
        domain: this.getRegistrableDomain(pageWindow.location.hostname),
        path: pageWindow.location.pathname,
        search: pageWindow.location.search,
        title: pageWindow.document.title,
      };
    }

    getRegistrableDomain(hostname) {
      const host = String(hostname || "").toLowerCase();

      if (!host) return "";
      if (host === "localhost") return "localhost";
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;

      const parts = host.split(".").filter(Boolean);

      if (parts.length <= 2) {
        return host;
      }

      // Basic heuristic. Good enough for now.
      // Later we can use a public suffix list if needed.
      return parts.slice(-2).join(".");
    }
  }

  if (!window.__BRUNNER_MAPPER__) {
    window.__BRUNNER_MAPPER__ = new BRunnerMapper();
  }
})();

import math


class HostFallbackError(Exception):
    pass


POINTER_ACTIONS = {
    "move",
    "click",
    "doubleClick",
    "rightClick",
    "scroll",
}

KEYBOARD_ACTIONS = {
    "type",
    "press",
    "shortcut",
    "paste",
}

SUPPORTED_ACTIONS = POINTER_ACTIONS | KEYBOARD_ACTIONS
CHROMIUM_PROCESS_NAMES = {"chrome", "chrome.exe", "chromium", "chromium.exe"}
CHROMIUM_WINDOW_CLASS_PREFIX = "chrome_widgetwin_"
CSS_VIEWPORT_COORDINATE_SPACE = "css_viewport"
PHYSICAL_SCREEN_COORDINATE_SPACE = "physical_screen"
MIN_DEVICE_PIXEL_RATIO = 0.5
MAX_DEVICE_PIXEL_RATIO = 8.0
USABLE_DPI_AWARENESS_MODES = {"per_monitor", "per_monitor_v2"}


def host_window_status(config, payload=None, adapter=None):
    settings = host_fallback_settings(config)
    request = payload if isinstance(payload, dict) else {}
    provider = adapter or default_adapter()
    screen = screen_snapshot(provider)
    session = session_snapshot(provider)
    foreground = foreground_window_snapshot(provider)
    expected = expected_window_title(request)
    matches_expected = expected_title_matches(foreground, expected)
    browser_verified = verified_chromium_window(foreground)
    context_error = None

    try:
        validate_visible_context(request, provider, snapshots=(screen, session, foreground))
    except HostFallbackError as exc:
        context_error = str(exc)

    return {
        "enabled": settings["enabled"],
        "minimumCoordinateConfidence": settings["minimumCoordinateConfidence"],
        "screen": screen,
        "session": session,
        "foregroundWindow": foreground,
        "browserVerified": browser_verified,
        "contextAvailable": context_error is None,
        "contextError": context_error,
        "expectedWindowTitle": expected,
        "matchesExpectedWindow": matches_expected,
        "supportedActions": sorted(SUPPORTED_ACTIONS),
    }


def validate_host_action(config, payload=None, adapter=None):
    request = payload if isinstance(payload, dict) else {}
    settings = host_fallback_settings(config)
    if not settings["enabled"]:
        raise HostFallbackError("Host fallback is disabled.")

    action = normalize_action(request.get("action") or request.get("type"))
    if action not in SUPPORTED_ACTIONS:
        raise HostFallbackError(f"Unsupported host action: {action or 'missing'}.")

    context = validate_visible_context(request, adapter or default_adapter())
    result = {
        "action": action,
        "screen": context["screen"],
        "session": context["session"],
        "foregroundWindow": context["foregroundWindow"],
        "minimumCoordinateConfidence": settings["minimumCoordinateConfidence"],
        "contextFingerprint": context_fingerprint(context),
    }

    if action in POINTER_ACTIONS:
        confidence = normalize_coordinate_confidence(
            first_present(
                request.get("confidence"),
                request.get("coordinateConfidence"),
                nested_get(request, "target", "confidence"),
                nested_get(request, "target", "coordinateConfidence"),
            )
        )
        if confidence < settings["minimumCoordinateConfidence"]:
            raise HostFallbackError("Coordinate confidence is below host fallback threshold.")

        point, mapping = normalized_target_point(request, context)
        if not point_inside_screen(point, context["screen"]):
            raise HostFallbackError("Target coordinates are outside the virtual display.")
        if not point_inside_rect(point, visible_window_rect(context)):
            raise HostFallbackError("Target coordinates are outside the foreground browser window.")

        result.update({
            "x": point["x"],
            "y": point["y"],
            "coordinateConfidence": confidence,
            "coordinateSpace": PHYSICAL_SCREEN_COORDINATE_SPACE,
            "sourceCoordinateSpace": mapping["sourceCoordinateSpace"],
            "coordinateMapping": mapping,
        })

    return result


def revalidate_host_action(config, payload, validated, adapter=None):
    request = payload if isinstance(payload, dict) else {}
    provider = adapter or default_adapter()
    previous_context = {
        "screen": validated.get("screen"),
        "session": validated.get("session"),
        "foregroundWindow": validated.get("foregroundWindow"),
    }
    context = revalidate_visible_context(request, previous_context, provider)
    current = context_fingerprint(context)

    refreshed = dict(validated)
    refreshed.update({
        "screen": context["screen"],
        "session": context["session"],
        "foregroundWindow": context["foregroundWindow"],
        "contextFingerprint": current,
    })
    if refreshed["action"] in POINTER_ACTIONS:
        point, mapping = normalized_target_point(request, context)
        previous_point = {"x": refreshed.get("x"), "y": refreshed.get("y")}
        if not points_equal(previous_point, point):
            raise HostFallbackError("Coordinate mapping changed before host input.")
        if not point_inside_screen(point, context["screen"]):
            raise HostFallbackError("Target coordinates are outside the virtual display.")
        if not point_inside_rect(point, visible_window_rect(context)):
            raise HostFallbackError("Target coordinates are outside the foreground browser window.")
        refreshed.update({
            "x": point["x"],
            "y": point["y"],
            "coordinateSpace": PHYSICAL_SCREEN_COORDINATE_SPACE,
            "sourceCoordinateSpace": mapping["sourceCoordinateSpace"],
            "coordinateMapping": mapping,
        })
    return refreshed


def revalidate_visible_context(request, previous_context, adapter=None):
    provider = adapter or default_adapter()
    context = validate_visible_context(request, provider)
    previous = context_fingerprint(previous_context or {})
    current = context_fingerprint(context)

    if previous["screen"] != current["screen"]:
        raise HostFallbackError("Virtual display layout changed before host input.")
    if previous["session"] != current["session"]:
        raise HostFallbackError("Interactive desktop session changed before host input.")
    if previous["window"] != current["window"]:
        raise HostFallbackError("Foreground browser window changed before host input.")
    return context


def validate_visible_context(request=None, adapter=None, snapshots=None):
    source = request if isinstance(request, dict) else {}
    provider = adapter or default_adapter()
    if snapshots is None:
        screen = screen_snapshot(provider)
        session = session_snapshot(provider)
        foreground = foreground_window_snapshot(provider)
    else:
        screen, session, foreground = snapshots

    if not valid_rect(screen):
        raise HostFallbackError("Virtual display bounds are unavailable.")
    if not session.get("available") or not session.get("interactive"):
        raise HostFallbackError("Interactive Windows session is unavailable or locked.")
    if not verified_chromium_window(foreground):
        raise HostFallbackError("Foreground window is not a verified Chrome or Chromium window.")
    if intersection_rect(screen, foreground) is None:
        raise HostFallbackError("Foreground browser window is outside the virtual display.")

    expected = expected_window_title(source)
    if expected and not expected_title_matches(foreground, expected):
        raise HostFallbackError("Expected browser window is not foreground.")

    return {
        "screen": screen,
        "session": session,
        "foregroundWindow": foreground,
    }


def context_fingerprint(context):
    screen = context.get("screen") or {}
    session = context.get("session") or {}
    window = context.get("foregroundWindow") or {}
    client = window.get("clientBounds") or {}
    renderer_viewports = window.get("rendererViewports") or []
    return {
        "screen": (
            int_value(screen.get("left")),
            int_value(screen.get("top")),
            int_value(screen.get("width")),
            int_value(screen.get("height")),
        ),
        "session": (
            bool(session.get("available")),
            bool(session.get("interactive")),
            str(session.get("desktopName") or "").casefold(),
        ),
        "window": (
            int_value(window.get("windowId")),
            int_value(window.get("processId")),
            str(window.get("processName") or "").casefold(),
            str(window.get("className") or "").casefold(),
            str(window.get("title") or ""),
            int_value(window.get("left")),
            int_value(window.get("top")),
            int_value(window.get("width")),
            int_value(window.get("height")),
            int_value(client.get("left")),
            int_value(client.get("top")),
            int_value(client.get("width")),
            int_value(client.get("height")),
            int_value(window.get("dpi")),
            str(window.get("dpiAwareness") or "").casefold(),
            tuple(
                (
                    int_value(viewport.get("windowId")),
                    int_value(viewport.get("left")),
                    int_value(viewport.get("top")),
                    int_value(viewport.get("width")),
                    int_value(viewport.get("height")),
                )
                for viewport in renderer_viewports
                if isinstance(viewport, dict)
            ),
            bool(window.get("visible")),
            bool(window.get("minimized")),
        ),
    }


def host_fallback_settings(config):
    source = config if isinstance(config, dict) else {}
    fallback = source.get("hostFallback") if isinstance(source.get("hostFallback"), dict) else {}
    return {
        "enabled": fallback.get("enabled") is not False,
        "minimumCoordinateConfidence": normalize_confidence(
            fallback.get("minimumCoordinateConfidence")
        ),
    }


def normalize_confidence(value):
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.9
    if confidence < 0 or confidence > 1:
        return 0.9
    return confidence


def normalize_coordinate_confidence(value):
    confidence = numeric_value(value, "coordinate confidence")
    if 1 < confidence <= 100:
        confidence = confidence / 100
    if confidence < 0 or confidence > 1:
        raise HostFallbackError("Invalid coordinate confidence.")
    return confidence


def screen_snapshot(adapter=None):
    provider = adapter or default_adapter()
    getter = getattr(provider, "virtual_screen_bounds", None)
    if not callable(getter):
        return empty_rect()
    try:
        return normalize_rect(getter())
    except Exception:
        return empty_rect()


def session_snapshot(adapter=None):
    provider = adapter or default_adapter()
    getter = getattr(provider, "session_snapshot", None)
    if not callable(getter):
        return {"available": False, "interactive": False, "desktopName": None}
    try:
        value = getter()
    except Exception:
        value = None
    source = value if isinstance(value, dict) else {}
    return {
        "available": source.get("available") is True,
        "interactive": source.get("interactive") is True,
        "desktopName": str(source.get("desktopName") or "").strip() or None,
    }


def foreground_window_snapshot(adapter=None):
    provider = adapter or default_adapter()
    getter = getattr(provider, "foreground_window_snapshot", None)
    if not callable(getter):
        return None
    try:
        value = getter()
    except Exception:
        return None
    if not isinstance(value, dict):
        return None

    rect = normalize_rect(value)
    client = normalize_rect(value.get("clientBounds"))
    client_bounds = client if valid_rect(client) else None
    renderer_viewports = normalize_renderer_viewports(value.get("rendererViewports"))
    dpi = int_value(value.get("dpi"))
    dpi = dpi if dpi > 0 else None
    scale_factor = finite_number_or_none(value.get("scaleFactor"))
    return {
        "windowId": int_value(value.get("windowId")),
        "title": str(value.get("title") or ""),
        "className": str(value.get("className") or ""),
        "processId": int_value(value.get("processId")),
        "processName": str(value.get("processName") or "").strip().casefold(),
        "executable": str(value.get("executable") or "").strip() or None,
        "left": rect["left"],
        "top": rect["top"],
        "width": rect["width"],
        "height": rect["height"],
        "clientBounds": client_bounds,
        "rendererViewports": renderer_viewports,
        "dpi": dpi,
        "scaleFactor": scale_factor if scale_factor and scale_factor > 0 else None,
        "dpiAwareness": str(value.get("dpiAwareness") or "").strip().casefold() or None,
        "visible": value.get("visible") is True,
        "minimized": value.get("minimized") is True,
    }


def verified_chromium_window(window):
    source = window if isinstance(window, dict) else {}
    process_name = str(source.get("processName") or "").strip().casefold()
    class_name = str(source.get("className") or "").strip().casefold()
    return (
        int_value(source.get("windowId")) > 0
        and int_value(source.get("processId")) > 0
        and process_name in CHROMIUM_PROCESS_NAMES
        and class_name.startswith(CHROMIUM_WINDOW_CLASS_PREFIX)
        and source.get("visible") is True
        and source.get("minimized") is not True
        and valid_rect(source)
    )


def expected_title_matches(foreground, expected):
    if not expected:
        return None
    title = str((foreground or {}).get("title") or "")
    return str(expected).casefold() in title.casefold()


def normalized_target_point(request, context):
    coordinate_space = str(request.get("coordinateSpace") or "").strip().casefold()
    coordinate_space = coordinate_space.replace("-", "_")
    if coordinate_space != CSS_VIEWPORT_COORDINATE_SPACE:
        raise HostFallbackError(
            "Pointer host actions require explicit css_viewport coordinates "
            "backed by a verified Chrome renderer viewport."
        )
    return css_viewport_point_to_physical(request, context)


def css_viewport_point_to_physical(request, context):
    client_point_source = request.get("clientPoint")
    client_bounds_source = request.get("clientBounds")
    if not isinstance(client_point_source, dict):
        raise coordinate_mapping_error("is unavailable: missing clientPoint")
    if not isinstance(client_bounds_source, dict):
        raise coordinate_mapping_error("is unavailable: missing clientBounds")

    client_x = required_mapping_number(client_point_source, "x", "clientPoint.x")
    client_y = required_mapping_number(client_point_source, "y", "clientPoint.y")
    viewport_width = required_mapping_number(
        client_bounds_source,
        "viewportWidth",
        "clientBounds.viewportWidth",
    )
    viewport_height = required_mapping_number(
        client_bounds_source,
        "viewportHeight",
        "clientBounds.viewportHeight",
    )
    dpr = required_mapping_number(request, "devicePixelRatio", "devicePixelRatio")
    bounds_dpr = required_mapping_number(
        client_bounds_source,
        "devicePixelRatio",
        "clientBounds.devicePixelRatio",
    )

    inner_width = viewport_width
    inner_height = viewport_height

    if not MIN_DEVICE_PIXEL_RATIO <= dpr <= MAX_DEVICE_PIXEL_RATIO:
        raise coordinate_mapping_error("is inconsistent: devicePixelRatio is out of range")
    if abs(dpr - bounds_dpr) > 1e-9:
        raise coordinate_mapping_error("is inconsistent: devicePixelRatio metrics disagree")
    if viewport_width <= 0 or viewport_height <= 0:
        raise coordinate_mapping_error("is inconsistent: CSS viewport dimensions must be positive")
    if not (
        0 <= client_x < inner_width
        and 0 <= client_y < inner_height
    ):
        raise coordinate_mapping_error("is inconsistent: client point is outside the viewport")

    foreground = context.get("foregroundWindow") or {}
    physical_client = foreground.get("clientBounds")
    renderer_viewports = foreground.get("rendererViewports") or []
    window_dpi = int_value(foreground.get("dpi"))
    dpi_awareness = str(foreground.get("dpiAwareness") or "").strip().casefold()
    if not valid_rect(foreground):
        raise coordinate_mapping_error("is unavailable: foreground window bounds are missing")
    if not valid_rect(physical_client):
        raise coordinate_mapping_error("is unavailable: foreground client bounds are missing")
    if window_dpi <= 0:
        raise coordinate_mapping_error("is unavailable: foreground window DPI is missing")
    if dpi_awareness not in USABLE_DPI_AWARENESS_MODES:
        raise coordinate_mapping_error(
            "is unavailable: per-monitor DPI awareness is required"
        )
    if not rect_inside_rect(physical_client, foreground):
        raise coordinate_mapping_error("is inconsistent: client bounds exceed the foreground window")

    matching_viewports = []
    for viewport in renderer_viewports:
        if not isinstance(viewport, dict) or not valid_rect(viewport):
            continue
        if str(viewport.get("className") or "").casefold() != "chrome_renderwidgethosthwnd":
            continue
        if not rect_inside_rect(viewport, physical_client):
            continue
        if not rect_inside_rect(viewport, foreground):
            continue
        width_error = abs(float(viewport["width"]) - inner_width * dpr)
        height_error = abs(float(viewport["height"]) - inner_height * dpr)
        rounding_tolerance = max(2.0, dpr + 0.5)
        if (
            width_error <= rounding_tolerance
            and height_error <= rounding_tolerance
        ):
            matching_viewports.append(viewport)

    if not matching_viewports:
        raise coordinate_mapping_error(
            "is unavailable: no verified renderer viewport matches the CSS metrics"
        )
    if len(matching_viewports) != 1:
        raise coordinate_mapping_error(
            "is unavailable: the verified renderer viewport is ambiguous"
        )

    renderer_viewport = matching_viewports[0]
    scale_x = float(renderer_viewport["width"]) / inner_width
    scale_y = float(renderer_viewport["height"]) / inner_height

    physical_point = {
        "x": int(math.floor(float(renderer_viewport["left"]) + client_x * scale_x)),
        "y": int(math.floor(float(renderer_viewport["top"]) + client_y * scale_y)),
    }
    if not point_inside_rect(physical_point, renderer_viewport):
        raise coordinate_mapping_error("is inconsistent: mapped point is outside the renderer viewport")
    if not point_inside_rect(physical_point, physical_client):
        raise coordinate_mapping_error("is inconsistent: mapped point is outside the client area")

    mapping = {
        "sourceCoordinateSpace": CSS_VIEWPORT_COORDINATE_SPACE,
        "targetCoordinateSpace": PHYSICAL_SCREEN_COORDINATE_SPACE,
        "method": "verified_renderer_viewport",
        "devicePixelRatio": dpr,
        "windowDpi": window_dpi,
        "dpiAwareness": dpi_awareness,
        "cssClientPoint": {"x": client_x, "y": client_y},
        "cssViewport": {"width": inner_width, "height": inner_height},
        "physicalWindowBounds": rect_copy(foreground),
        "physicalClientBounds": rect_copy(physical_client),
        "physicalRendererViewport": rect_copy(renderer_viewport),
        "rendererWindowId": int_value(renderer_viewport.get("windowId")),
        "scaleX": scale_x,
        "scaleY": scale_y,
    }
    return physical_point, mapping


def coordinate_mapping_error(reason):
    message = str(reason or "failed").strip().rstrip(".")
    return HostFallbackError(f"CSS-viewport-to-physical coordinate mapping {message}.")


def required_mapping_number(source, key, label):
    if not isinstance(source, dict) or key not in source or source.get(key) is None:
        raise coordinate_mapping_error(f"is unavailable: missing {label}")
    return mapping_number(source.get(key), label)


def mapping_number(value, label):
    if isinstance(value, bool):
        raise coordinate_mapping_error(f"is inconsistent: invalid {label}")
    try:
        return numeric_value(value, label)
    except HostFallbackError as exc:
        raise coordinate_mapping_error(f"is inconsistent: invalid {label}") from exc


def point_inside_screen(point, screen):
    if not valid_rect(screen):
        raise HostFallbackError("Virtual display bounds are unavailable.")
    return point_inside_rect(point, screen)


def point_inside_rect(point, rect):
    if not valid_rect(rect):
        return False
    try:
        x = numeric_value(point.get("x"), "x")
        y = numeric_value(point.get("y"), "y")
    except (AttributeError, HostFallbackError):
        return False
    left = rect["left"]
    top = rect["top"]
    return left <= x < left + rect["width"] and top <= y < top + rect["height"]


def rect_inside_rect(inner, outer):
    if not valid_rect(inner) or not valid_rect(outer):
        return False
    return (
        inner["left"] >= outer["left"]
        and inner["top"] >= outer["top"]
        and inner["left"] + inner["width"] <= outer["left"] + outer["width"]
        and inner["top"] + inner["height"] <= outer["top"] + outer["height"]
    )


def points_equal(first, second, tolerance=0.01):
    try:
        return (
            abs(numeric_value(first.get("x"), "x") - numeric_value(second.get("x"), "x"))
            <= tolerance
            and abs(numeric_value(first.get("y"), "y") - numeric_value(second.get("y"), "y"))
            <= tolerance
        )
    except (AttributeError, HostFallbackError):
        return False


def intersection_rect(first, second):
    if not valid_rect(first) or not valid_rect(second):
        return None
    left = max(first["left"], second["left"])
    top = max(first["top"], second["top"])
    right = min(first["left"] + first["width"], second["left"] + second["width"])
    bottom = min(first["top"] + first["height"], second["top"] + second["height"])
    if right <= left or bottom <= top:
        return None
    return {"left": left, "top": top, "width": right - left, "height": bottom - top}


def visible_window_rect(context):
    return intersection_rect(
        context.get("screen") or {},
        context.get("foregroundWindow") or {},
    )


def expected_window_title(request):
    window = request.get("window") if isinstance(request.get("window"), dict) else {}
    browser_window = (
        request.get("browserWindow")
        if isinstance(request.get("browserWindow"), dict)
        else {}
    )
    value = first_present(
        request.get("expectedWindowTitle"),
        request.get("windowTitle"),
        window.get("expectedTitle"),
        window.get("title"),
        browser_window.get("title"),
    )
    text = str(value or "").strip()
    return text or None


def normalize_action(value):
    text = str(value or "").strip()
    aliases = {
        "double-click": "doubleClick",
        "double_click": "doubleClick",
        "right-click": "rightClick",
        "right_click": "rightClick",
        "typeText": "type",
        "type_text": "type",
    }
    return aliases.get(text, text)


def normalize_rect(value):
    source = value if isinstance(value, dict) else {}
    return {
        "left": int_value(source.get("left")),
        "top": int_value(source.get("top")),
        "width": max(0, int_value(source.get("width"))),
        "height": max(0, int_value(source.get("height"))),
    }


def normalize_renderer_viewports(value):
    if not isinstance(value, list):
        return []
    viewports = []
    for item in value:
        if not isinstance(item, dict):
            continue
        rect = normalize_rect(item)
        if not valid_rect(rect):
            continue
        viewports.append({
            "windowId": int_value(item.get("windowId")),
            "className": str(item.get("className") or ""),
            **rect,
        })
    return sorted(
        viewports,
        key=lambda viewport: (
            viewport["top"],
            viewport["left"],
            viewport["windowId"],
        ),
    )


def rect_copy(value):
    source = value if isinstance(value, dict) else {}
    return {
        "left": source.get("left"),
        "top": source.get("top"),
        "width": source.get("width"),
        "height": source.get("height"),
    }


def empty_rect():
    return {"left": 0, "top": 0, "width": 0, "height": 0}


def valid_rect(value):
    return (
        isinstance(value, dict)
        and int_value(value.get("width")) > 0
        and int_value(value.get("height")) > 0
    )


def numeric_value(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise HostFallbackError(f"Invalid {label}.")
    if not math.isfinite(number):
        raise HostFallbackError(f"Invalid {label}.")
    return number


def int_value(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def finite_number_or_none(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def first_present(*values):
    for value in values:
        if value is not None:
            return value
    return None


def nested_get(source, key, nested_key):
    nested = source.get(key) if isinstance(source.get(key), dict) else {}
    return nested.get(nested_key)


def default_adapter():
    from windows_desktop import WindowsDesktopAdapter

    return WindowsDesktopAdapter()

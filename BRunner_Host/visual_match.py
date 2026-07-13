import base64
import io
import time

from PIL import Image

from window_validation import (
    HostFallbackError,
    expected_window_title,
    foreground_window_snapshot,
    host_fallback_settings,
    normalize_action,
    normalize_confidence,
    point_inside_screen,
    screen_snapshot,
)


VISUAL_POINTER_ACTIONS = {"click", "doubleClick"}


def execute_visual_match_action(config, payload=None, adapter=None):
    provider = adapter or default_adapter()
    request = payload if isinstance(payload, dict) else {}
    settings = host_fallback_settings(config)
    if not settings["enabled"]:
        raise HostFallbackError("Host fallback is disabled.")

    action = normalize_action(request.get("action") or request.get("type"))
    if action not in VISUAL_POINTER_ACTIONS:
        raise HostFallbackError(f"Unsupported visual-match action: {action or 'missing'}.")

    screen = screen_snapshot(provider)
    foreground = foreground_window_snapshot(provider)
    expected = expected_window_title(request)
    if expected:
        title = str((foreground or {}).get("title") or "")
        if expected.lower() not in title.lower():
            raise HostFallbackError("Expected browser window is not foreground.")

    threshold = visual_match_confidence(request, settings)
    template = decode_template_image(request)
    search_region = foreground_search_region(foreground, screen)
    started_at = time.perf_counter()
    match = locate_single_match(provider, template, threshold, search_region)
    search_duration_ms = max(0, round((time.perf_counter() - started_at) * 1000))
    point = {
        "x": match["left"] + match["width"] / 2,
        "y": match["top"] + match["height"] / 2,
    }
    if not point_inside_screen(point, screen):
        raise HostFallbackError("Visual match coordinates are outside the visible screen.")

    clicks = 2 if action == "doubleClick" else 1
    provider.click(point["x"], point["y"], clicks=clicks, button="left")

    return {
        "performed": True,
        "action": action,
        "method": "visible_host_visual_match",
        "x": point["x"],
        "y": point["y"],
        "matchConfidence": match.get("confidence", threshold),
        "minimumMatchConfidence": threshold,
        "matchedBox": match,
        "foregroundWindow": foreground,
        "searchRegion": region_to_dict(search_region),
        "searchDurationMs": search_duration_ms,
    }


def visual_match_confidence(request, settings):
    return normalize_confidence(
        request.get("matchConfidence")
        or request.get("visualMatchConfidence")
        or settings.get("minimumVisualMatchConfidence")
        or settings.get("minimumCoordinateConfidence")
    )


def decode_template_image(request):
    value = (
        request.get("imageDataUrl")
        or request.get("image")
        or request.get("templateImage")
        or ""
    )
    text = str(value).strip()
    if not text:
        raise HostFallbackError("Missing visual-match component image.")

    if "," in text and text.lower().startswith("data:"):
        text = text.split(",", 1)[1]

    try:
        raw = base64.b64decode(text, validate=True)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise HostFallbackError("Invalid visual-match component image.") from exc

    width, height = image.size
    if width <= 0 or height <= 0:
        raise HostFallbackError("Invalid visual-match component image.")

    return image


def locate_single_match(provider, template, threshold, region=None):
    matches = list(first_two_matches(provider, template, threshold, region))
    if not matches:
        raise HostFallbackError("Visual match target was not found.")
    if len(matches) > 1:
        raise HostFallbackError("Visual match target is ambiguous.")

    match = box_to_dict(matches[0])
    confidence = match.get("confidence")
    if confidence is not None and confidence < threshold:
        raise HostFallbackError("Visual match confidence is below host fallback threshold.")
    return match


def first_two_matches(provider, template, threshold, region=None):
    locator = getattr(provider, "locateAllOnScreen", None)
    if callable(locator):
        yield from locate_with_supported_options(locator, template, threshold, region)
        return

    locator = getattr(provider, "locateOnScreen", None)
    if not callable(locator):
        raise HostFallbackError("PyAutoGUI visual matching is unavailable.")

    match = locate_one_with_supported_options(locator, template, threshold, region)
    if match is not None:
        yield match


def locate_with_supported_options(locator, template, threshold, region):
    option_sets = visual_locator_option_sets(threshold, region)
    last_error = None
    for options in option_sets:
        try:
            yield from limited_matches(locator(template, **options), 2)
            return
        except (TypeError, NotImplementedError) as error:
            last_error = error
    if last_error:
        raise HostFallbackError("PyAutoGUI visual matching is unavailable.") from last_error


def locate_one_with_supported_options(locator, template, threshold, region):
    last_error = None
    for options in visual_locator_option_sets(threshold, region):
        try:
            return locator(template, **options)
        except (TypeError, NotImplementedError) as error:
            last_error = error
    if last_error:
        raise HostFallbackError("PyAutoGUI visual matching is unavailable.") from last_error
    return None


def visual_locator_option_sets(threshold, region):
    full = {"confidence": threshold, "grayscale": True}
    if region:
        full["region"] = region
    options = [full]
    if region:
        options.append({"region": region})
    options.append({})
    return options


def foreground_search_region(foreground, screen):
    window = foreground if isinstance(foreground, dict) else {}
    desktop = screen if isinstance(screen, dict) else {}
    screen_left = int(desktop.get("left") or 0)
    screen_top = int(desktop.get("top") or 0)
    screen_width = max(0, int(desktop.get("width") or 0))
    screen_height = max(0, int(desktop.get("height") or 0))
    window_width = max(0, int(window.get("width") or 0))
    window_height = max(0, int(window.get("height") or 0))
    if screen_width <= 0 or screen_height <= 0 or window_width <= 0 or window_height <= 0:
        return None

    left = max(screen_left, int(window.get("left") or 0))
    top = max(screen_top, int(window.get("top") or 0))
    right = min(screen_left + screen_width, int(window.get("left") or 0) + window_width)
    bottom = min(screen_top + screen_height, int(window.get("top") or 0) + window_height)
    if right <= left or bottom <= top:
        return None
    return (left, top, right - left, bottom - top)


def region_to_dict(region):
    if not region:
        return None
    left, top, width, height = region
    return {
        "left": left,
        "top": top,
        "width": width,
        "height": height,
    }


def limited_matches(iterator, limit):
    count = 0
    for match in iterator or []:
        if match is None:
            continue
        yield match
        count += 1
        if count >= limit:
            break


def box_to_dict(box):
    if isinstance(box, dict):
        left = box.get("left")
        top = box.get("top")
        width = box.get("width")
        height = box.get("height")
        confidence = box.get("confidence")
    else:
        left = box_value(box, "left", 0)
        top = box_value(box, "top", 1)
        width = box_value(box, "width", 2)
        height = box_value(box, "height", 3)
        confidence = getattr(box, "confidence", None)

    result = {
        "left": float(left),
        "top": float(top),
        "width": float(width),
        "height": float(height),
    }
    if confidence is not None:
        result["confidence"] = float(confidence)
    return result


def box_value(box, attribute, index):
    if hasattr(box, attribute):
        return getattr(box, attribute)
    return box[index]


def default_adapter():
    import pyautogui
    return pyautogui

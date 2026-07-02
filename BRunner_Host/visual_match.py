import base64
import io

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
    match = locate_single_match(provider, template, threshold)
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


def locate_single_match(provider, template, threshold):
    matches = list(first_two_matches(provider, template, threshold))
    if not matches:
        raise HostFallbackError("Visual match target was not found.")
    if len(matches) > 1:
        raise HostFallbackError("Visual match target is ambiguous.")

    match = box_to_dict(matches[0])
    confidence = match.get("confidence")
    if confidence is not None and confidence < threshold:
        raise HostFallbackError("Visual match confidence is below host fallback threshold.")
    return match


def first_two_matches(provider, template, threshold):
    locator = getattr(provider, "locateAllOnScreen", None)
    if callable(locator):
        try:
            yield from limited_matches(
                locator(template, confidence=threshold, grayscale=True),
                2,
            )
        except (TypeError, NotImplementedError):
            yield from limited_matches(locator(template), 2)
        return

    locator = getattr(provider, "locateOnScreen", None)
    if not callable(locator):
        raise HostFallbackError("PyAutoGUI visual matching is unavailable.")

    try:
        match = locator(template, confidence=threshold, grayscale=True)
    except (TypeError, NotImplementedError):
        match = locator(template)
    if match is not None:
        yield match


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

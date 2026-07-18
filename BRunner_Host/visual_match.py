import base64
import io
import math
import time

from PIL import Image

from window_validation import (
    HostFallbackError,
    host_fallback_settings,
    intersection_rect,
    normalize_action,
    normalize_confidence,
    rect_inside_rect,
    revalidate_visible_context,
    validate_visible_context,
)


VISUAL_POINTER_ACTIONS = {"click", "doubleClick"}
MAX_TEMPLATE_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TEMPLATE_BASE64_CHARS = ((MAX_TEMPLATE_IMAGE_BYTES + 2) // 3) * 4
MAX_TEMPLATE_DIMENSION = 4096
MAX_TEMPLATE_PIXELS = 16 * 1024 * 1024
ALLOWED_TEMPLATE_FORMATS = {"JPEG", "PNG", "WEBP"}
ALLOWED_TEMPLATE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}


def execute_visual_match_action(config, payload=None, adapter=None):
    provider = adapter or default_adapter()
    request = payload if isinstance(payload, dict) else {}
    settings = host_fallback_settings(config)
    if not settings["enabled"]:
        raise HostFallbackError("Host fallback is disabled.")

    action = normalize_action(request.get("action") or request.get("type"))
    if action not in VISUAL_POINTER_ACTIONS:
        raise HostFallbackError(f"Unsupported visual-match action: {action or 'missing'}.")

    context = validate_visible_context(request, provider)
    screen = context["screen"]
    foreground = context["foregroundWindow"]
    search_region = foreground_search_region(foreground, screen)
    if search_region is None:
        raise HostFallbackError("Foreground browser capture region is unavailable.")

    threshold = visual_match_confidence(request, settings)
    template = decode_template_image(request)
    started_at = time.perf_counter()
    match = locate_single_match(provider, template, threshold, search_region)
    search_duration_ms = max(0, round((time.perf_counter() - started_at) * 1000))

    region_rect = region_to_dict(search_region)
    if not rect_inside_rect(match, region_rect):
        raise HostFallbackError("Visual match extends outside the foreground browser window.")

    context = revalidate_visible_context(request, context, provider)
    refreshed_region = foreground_search_region(
        context["foregroundWindow"],
        context["screen"],
    )
    if refreshed_region != search_region:
        raise HostFallbackError("Foreground browser capture region changed before host input.")
    if not rect_inside_rect(match, region_to_dict(refreshed_region)):
        raise HostFallbackError("Visual match extends outside the foreground browser window.")

    point = {
        "x": match["left"] + match["width"] / 2,
        "y": match["top"] + match["height"] / 2,
    }
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
        "foregroundWindow": context["foregroundWindow"],
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

    encoded = text
    declared_mime = None
    if text.casefold().startswith("data:"):
        header, separator, encoded = text.partition(",")
        header_parts = header[5:].split(";")
        declared_mime = str(header_parts[0] or "").strip().casefold()
        flags = {part.strip().casefold() for part in header_parts[1:]}
        if (
            not separator
            or declared_mime not in ALLOWED_TEMPLATE_MIME_TYPES
            or "base64" not in flags
        ):
            raise HostFallbackError("Invalid visual-match component image.")

    if not encoded or len(encoded) > MAX_TEMPLATE_BASE64_CHARS:
        raise HostFallbackError("Visual-match component image exceeds the size limit.")

    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise HostFallbackError("Invalid visual-match component image.") from exc
    if not raw or len(raw) > MAX_TEMPLATE_IMAGE_BYTES:
        raise HostFallbackError("Visual-match component image exceeds the size limit.")

    try:
        with Image.open(io.BytesIO(raw)) as candidate:
            image_format = str(candidate.format or "").upper()
            width, height = candidate.size
            if image_format not in ALLOWED_TEMPLATE_FORMATS:
                raise HostFallbackError("Unsupported visual-match component image format.")
            if declared_mime and not format_matches_mime(image_format, declared_mime):
                raise HostFallbackError("Visual-match image type does not match its data URL.")
            if (
                width <= 0
                or height <= 0
                or width > MAX_TEMPLATE_DIMENSION
                or height > MAX_TEMPLATE_DIMENSION
                or width * height > MAX_TEMPLATE_PIXELS
            ):
                raise HostFallbackError("Visual-match component image dimensions exceed the limit.")
            candidate.load()
            return candidate.copy()
    except HostFallbackError:
        raise
    except Exception as exc:
        raise HostFallbackError("Invalid visual-match component image.") from exc


def format_matches_mime(image_format, mime_type):
    expected = {
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "WEBP": "image/webp",
    }
    return expected.get(image_format) == mime_type


def locate_single_match(provider, template, threshold, region):
    matches = list(first_two_matches(provider, template, threshold, region))
    if not matches:
        raise HostFallbackError("Visual match target was not found.")
    if len(matches) > 1:
        raise HostFallbackError("Visual match target is ambiguous.")

    match = matches[0]
    confidence = match.get("confidence")
    if confidence is not None and confidence < threshold:
        raise HostFallbackError("Visual match confidence is below host fallback threshold.")
    return match


def first_two_matches(provider, template, threshold, region):
    if not region:
        raise HostFallbackError("Foreground browser capture region is unavailable.")
    capture = getattr(provider, "capture_region", None)
    if not callable(capture):
        raise HostFallbackError("Bounded Windows screen capture is unavailable.")
    try:
        haystack = capture(region)
    except Exception as exc:
        raise HostFallbackError("Could not capture the foreground browser window.") from exc

    expected_size = (int(region[2]), int(region[3]))
    if getattr(haystack, "size", None) != expected_size:
        raise HostFallbackError("Foreground browser capture has unexpected dimensions.")

    locator = getattr(provider, "locateAll", None)
    if callable(locator):
        local_matches = locate_with_supported_options(locator, template, haystack, threshold)
    else:
        locator = getattr(provider, "locate", None)
        if not callable(locator):
            raise HostFallbackError("PyAutoGUI visual matching is unavailable.")
        local_match = locate_one_with_supported_options(locator, template, haystack, threshold)
        local_matches = [] if local_match is None else [local_match]

    local_bounds = {"left": 0, "top": 0, "width": region[2], "height": region[3]}
    for match in limited_matches(local_matches, 2):
        local = box_to_dict(match)
        if not rect_inside_rect(local, local_bounds):
            raise HostFallbackError("Visual match extends outside the captured browser region.")
        yield {
            **local,
            "left": local["left"] + region[0],
            "top": local["top"] + region[1],
        }


def locate_with_supported_options(locator, template, haystack, threshold):
    last_error = None
    for options in visual_locator_option_sets(threshold):
        try:
            return list(limited_matches(locator(template, haystack, **options), 2))
        except (TypeError, NotImplementedError) as error:
            last_error = error
    raise HostFallbackError("Confidence-aware visual matching is unavailable.") from last_error


def locate_one_with_supported_options(locator, template, haystack, threshold):
    last_error = None
    for options in visual_locator_option_sets(threshold):
        try:
            return locator(template, haystack, **options)
        except (TypeError, NotImplementedError) as error:
            last_error = error
    raise HostFallbackError("Confidence-aware visual matching is unavailable.") from last_error


def visual_locator_option_sets(threshold):
    return [
        {"confidence": threshold, "grayscale": True},
        {"confidence": threshold},
    ]


def foreground_search_region(foreground, screen):
    region = intersection_rect(screen or {}, foreground or {})
    if region is None:
        return None
    return (region["left"], region["top"], region["width"], region["height"])


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
        "left": finite_number(left),
        "top": finite_number(top),
        "width": finite_number(width),
        "height": finite_number(height),
    }
    if result["width"] <= 0 or result["height"] <= 0:
        raise HostFallbackError("Visual match returned invalid bounds.")
    if confidence is not None:
        result["confidence"] = finite_number(confidence)
    return result


def finite_number(value):
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise HostFallbackError("Visual match returned invalid bounds.") from exc
    if not math.isfinite(result):
        raise HostFallbackError("Visual match returned invalid bounds.")
    return result


def box_value(box, attribute, index):
    if hasattr(box, attribute):
        return getattr(box, attribute)
    return box[index]


def default_adapter():
    from windows_desktop import WindowsDesktopAdapter

    return WindowsDesktopAdapter()

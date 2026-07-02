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


def host_window_status(config, payload=None, adapter=None):
    settings = host_fallback_settings(config)
    screen = screen_snapshot(adapter)
    foreground = foreground_window_snapshot(adapter)
    expected = expected_window_title(payload or {})
    matches_expected = None

    if expected:
        title = str((foreground or {}).get("title") or "")
        matches_expected = expected.lower() in title.lower()

    return {
        "enabled": settings["enabled"],
        "minimumCoordinateConfidence": settings["minimumCoordinateConfidence"],
        "screen": screen,
        "foregroundWindow": foreground,
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

    screen = screen_snapshot(adapter)
    foreground = foreground_window_snapshot(adapter)
    expected = expected_window_title(request)
    if expected:
        title = str((foreground or {}).get("title") or "")
        if expected.lower() not in title.lower():
            raise HostFallbackError("Expected browser window is not foreground.")

    result = {
        "action": action,
        "screen": screen,
        "foregroundWindow": foreground,
        "minimumCoordinateConfidence": settings["minimumCoordinateConfidence"],
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

        point = target_point(request)
        if not point_inside_screen(point, screen):
            raise HostFallbackError("Target coordinates are outside the visible screen.")

        result.update({
            "x": point["x"],
            "y": point["y"],
            "coordinateConfidence": confidence,
        })

    return result


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
    try:
        size = provider.size()
        width = int(getattr(size, "width", size[0]))
        height = int(getattr(size, "height", size[1]))
    except Exception:
        width = 0
        height = 0
    return {
        "left": 0,
        "top": 0,
        "width": max(width, 0),
        "height": max(height, 0),
    }


def foreground_window_snapshot(adapter=None):
    provider = adapter or default_adapter()
    getter = getattr(provider, "getActiveWindow", None)
    if not callable(getter):
        return None

    try:
        window = getter()
    except Exception:
        return None

    if window is None:
        return None

    return {
        "title": str(getattr(window, "title", "") or ""),
        "left": int_value(getattr(window, "left", 0)),
        "top": int_value(getattr(window, "top", 0)),
        "width": int_value(getattr(window, "width", 0)),
        "height": int_value(getattr(window, "height", 0)),
    }


def target_point(request):
    target = request.get("target") if isinstance(request.get("target"), dict) else {}
    bounds = request.get("bounds") if isinstance(request.get("bounds"), dict) else {}
    point = request.get("point") if isinstance(request.get("point"), dict) else {}

    x = first_present(
        request.get("x"),
        request.get("screenX"),
        point.get("x"),
        point.get("screenX"),
        target.get("x"),
        target.get("screenX"),
    )
    y = first_present(
        request.get("y"),
        request.get("screenY"),
        point.get("y"),
        point.get("screenY"),
        target.get("y"),
        target.get("screenY"),
    )

    if x is not None and y is not None:
        return {
            "x": numeric_value(x, "x"),
            "y": numeric_value(y, "y"),
        }

    left = first_present(bounds.get("left"), target.get("left"))
    top = first_present(bounds.get("top"), target.get("top"))
    width = first_present(bounds.get("width"), target.get("width"))
    height = first_present(bounds.get("height"), target.get("height"))

    if None in {left, top, width, height}:
        raise HostFallbackError("Missing target coordinates.")

    return {
        "x": numeric_value(left, "left") + numeric_value(width, "width") / 2,
        "y": numeric_value(top, "top") + numeric_value(height, "height") / 2,
    }


def point_inside_screen(point, screen):
    width = screen.get("width") or 0
    height = screen.get("height") or 0
    if width <= 0 or height <= 0:
        raise HostFallbackError("Screen size is unavailable.")
    return (
        0 <= point["x"] < width
        and 0 <= point["y"] < height
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


def first_present(*values):
    for value in values:
        if value is not None:
            return value
    return None


def nested_get(source, key, nested_key):
    nested = source.get(key) if isinstance(source.get(key), dict) else {}
    return nested.get(nested_key)


def default_adapter():
    import pyautogui
    return pyautogui

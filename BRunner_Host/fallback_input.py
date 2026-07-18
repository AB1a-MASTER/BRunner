from window_validation import HostFallbackError, revalidate_host_action, validate_host_action


def execute_host_action(config, payload=None, adapter=None):
    provider = adapter or default_adapter()
    validated = validate_host_action(config, payload, provider)
    request = payload if isinstance(payload, dict) else {}
    action = validated["action"]
    validated = revalidate_host_action(config, request, validated, provider)

    if action == "move":
        provider.moveTo(validated["x"], validated["y"])
    elif action == "click":
        provider.click(validated["x"], validated["y"], button="left")
    elif action == "doubleClick":
        provider.click(validated["x"], validated["y"], clicks=2, button="left")
    elif action == "rightClick":
        provider.click(validated["x"], validated["y"], button="right")
    elif action == "scroll":
        amount = int_value(request.get("amount") or request.get("deltaY") or request.get("scrollY") or -1)
        provider.moveTo(validated["x"], validated["y"])
        validated = revalidate_host_action(config, request, validated, provider)
        provider.scroll(amount)
    elif action == "type":
        text = str(request.get("text") or request.get("value") or "")
        provider.write(text, interval=number_or_default(request.get("interval"), 0))
    elif action == "press":
        key = str(request.get("key") or "").strip().lower()
        if not key:
            raise HostFallbackError("Missing key for host press action.")
        provider.press(key)
    elif action == "shortcut":
        keys = normalize_keys(request.get("keys"))
        if not keys:
            raise HostFallbackError("Missing keys for host shortcut action.")
        provider.hotkey(*keys)
    elif action == "paste":
        provider.hotkey("ctrl", "v")
    else:
        raise HostFallbackError(f"Unsupported host action: {action}.")

    return {
        "performed": True,
        "action": action,
        "method": "visible_host_fallback",
        "x": validated.get("x"),
        "y": validated.get("y"),
        "coordinateConfidence": validated.get("coordinateConfidence"),
        "coordinateSpace": validated.get("coordinateSpace"),
        "sourceCoordinateSpace": validated.get("sourceCoordinateSpace"),
        "coordinateMapping": validated.get("coordinateMapping"),
        "foregroundWindow": validated.get("foregroundWindow"),
    }


def normalize_keys(value):
    if isinstance(value, list):
        return [
            str(key).strip().lower()
            for key in value
            if str(key).strip()
        ]
    return [
        part.strip().lower()
        for part in str(value or "").replace(" ", "").split("+")
        if part.strip()
    ]


def int_value(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1


def number_or_default(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def default_adapter():
    from windows_desktop import WindowsDesktopAdapter

    return WindowsDesktopAdapter()

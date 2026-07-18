from host_settings import (
    is_valid_profile_instance_id,
    normalize_profile_instance_id,
)


class PairingCoordinator:
    """Coordinate one configured profile and one live WebSocket connection."""

    def __init__(self, load_settings, save_settings, report_connection=None):
        self.load_settings = load_settings
        self.save_settings = save_settings
        self.report_connection = report_connection or (lambda profile_instance_id: None)
        self.active_connection = None
        self.active_profile_instance_id = None

    def announce(self, connection, profile_instance_id):
        profile_instance_id, error = self._validated_id(profile_instance_id)
        if error:
            return error
        paired_instance_id = self._paired_instance_id()
        if not paired_instance_id:
            return self._failure(
                "pairing_required",
                "Pair this Chrome profile with the companion before continuing.",
                profile_instance_id,
                pairing_state="unpaired",
            )
        if paired_instance_id != profile_instance_id:
            return self._other_profile(profile_instance_id)
        return self._claim_connection(connection, profile_instance_id)

    def pair(self, connection, profile_instance_id):
        profile_instance_id, error = self._validated_id(profile_instance_id)
        if error:
            return error
        settings = self.load_settings()
        paired_instance_id = normalize_profile_instance_id(
            settings.get("pairedInstanceId")
        )
        if paired_instance_id and paired_instance_id != profile_instance_id:
            return self._other_profile(profile_instance_id)
        if self.active_connection is not None and self.active_connection is not connection:
            return self._active_connection_failure(profile_instance_id)
        if not paired_instance_id:
            settings["pairedInstanceId"] = profile_instance_id
            self.save_settings(settings)
        return self._claim_connection(connection, profile_instance_id)

    def unpair(self, connection, profile_instance_id):
        profile_instance_id, error = self._validated_id(profile_instance_id)
        if error:
            return error
        settings = self.load_settings()
        paired_instance_id = normalize_profile_instance_id(
            settings.get("pairedInstanceId")
        )
        if paired_instance_id and paired_instance_id != profile_instance_id:
            return self._other_profile(profile_instance_id)
        if self.active_connection is not None and self.active_connection is not connection:
            return self._active_connection_failure(profile_instance_id)
        if paired_instance_id:
            settings["pairedInstanceId"] = None
            self.save_settings(settings)
        self.release(connection)
        return self._success(
            profile_instance_id,
            paired=False,
            connected=False,
            pairing_state="unpaired",
            message="Chrome profile unpaired from the companion.",
        )

    def validate_session(self, connection, profile_instance_id):
        profile_instance_id, error = self._validated_id(profile_instance_id)
        if error:
            return error
        paired_instance_id = self._paired_instance_id()
        if not paired_instance_id:
            self.release(connection)
            return self.pairing_required(profile_instance_id)
        if paired_instance_id != profile_instance_id:
            self.release(connection)
            return self._other_profile(profile_instance_id)
        if (
            self.active_connection is not connection
            or self.active_profile_instance_id != profile_instance_id
        ):
            return self._failure(
                "pairing_session_inactive",
                "This connection has not been accepted for the paired Chrome profile.",
                profile_instance_id,
            )
        return self._success(profile_instance_id)

    def pairing_required(self, profile_instance_id=""):
        return self._failure(
            "pairing_required",
            "Pair this Chrome profile with the companion before continuing.",
            normalize_profile_instance_id(profile_instance_id),
            pairing_state="unpaired",
        )

    def release(self, connection):
        if self.active_connection is not connection:
            return False
        self.active_connection = None
        self.active_profile_instance_id = None
        self.report_connection(None)
        return True

    def _claim_connection(self, connection, profile_instance_id):
        if self.active_connection is not None and self.active_connection is not connection:
            return self._active_connection_failure(profile_instance_id)
        self.active_connection = connection
        self.active_profile_instance_id = profile_instance_id
        self.report_connection(profile_instance_id)
        return self._success(
            profile_instance_id,
            message="Chrome profile paired and connected.",
        )

    def _paired_instance_id(self):
        settings = self.load_settings()
        value = normalize_profile_instance_id(settings.get("pairedInstanceId"))
        return value if is_valid_profile_instance_id(value) else ""

    def _validated_id(self, value):
        normalized = normalize_profile_instance_id(value)
        if is_valid_profile_instance_id(normalized):
            return normalized, None
        return normalized, self._failure(
            "invalid_profile_instance_id",
            "A valid profile instance ID is required.",
            normalized,
        )

    def _other_profile(self, profile_instance_id):
        return self._failure(
            "paired_to_other_profile",
            "This companion is paired to another Chrome profile. Unpair it before pairing this profile.",
            profile_instance_id,
            pairing_state="paired_to_other_profile",
        )

    def _active_connection_failure(self, profile_instance_id):
        return self._failure(
            "paired_connection_active",
            "The paired Chrome profile already has an active companion connection.",
            profile_instance_id,
            pairing_state="paired_connection_active",
        )

    @staticmethod
    def _success(
        profile_instance_id,
        paired=True,
        connected=True,
        pairing_state="paired",
        message="Chrome profile accepted.",
    ):
        return {
            "ok": True,
            "code": "paired" if paired else "unpaired",
            "message": message,
            "pairingState": pairing_state,
            "paired": paired,
            "connected": connected,
            "profileInstanceId": profile_instance_id,
        }

    @staticmethod
    def _failure(code, message, profile_instance_id, pairing_state=None):
        return {
            "ok": False,
            "code": code,
            "message": message,
            "pairingState": pairing_state or code,
            "paired": False,
            "connected": False,
            "profileInstanceId": profile_instance_id,
        }

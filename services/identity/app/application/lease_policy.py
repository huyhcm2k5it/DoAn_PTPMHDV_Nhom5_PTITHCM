"""Only documented actions can receive a current thirty-second lease."""
POLICY = {
    "CA-004": {"STAFF": {"ADMIN"}},
    "PT-003": {"PATIENT": set(), "STAFF": {"RECEPTION"}},
    "PT-005": {"PATIENT": set(), "STAFF": {"RECEPTION"}},
    "AP-002": {"STAFF": {"ADMIN"}},
    "AP-003": {"STAFF": {"ADMIN"}},
    "AP-008": {"PATIENT": set(), "STAFF": {"RECEPTION"}},
    "AP-009": {"PATIENT": set(), "STAFF": {"RECEPTION"}},
    "AP-010": {"PATIENT": set(), "STAFF": {"RECEPTION"}},
    "AP-013": {"PATIENT": set(), "STAFF": {"RECEPTION"}},
    "AP-014": {"PATIENT": set(), "STAFF": {"RECEPTION"}},
    "AP-015": {"STAFF": {"RECEPTION"}},
    "AP-017": {"STAFF": {"RECEPTION"}},
    "AP-018": {"STAFF": {"RECEPTION"}},
    "PH-002": {"STAFF": {"PHARMACY"}},
    "PH-003": {"STAFF": {"PHARMACY"}},
    "PH-004": {"STAFF": {"PHARMACY"}, "PATIENT": set()},
    "PH-005": {"STAFF": {"PHARMACY"}},
    "PH-006": {"STAFF": {"PHARMACY"}},
    "PH-007": {"STAFF": {"PHARMACY"}},
    "PH-008": {"STAFF": {"PHARMACY"}},
    "DI-008": {"STAFF": {"LAB_TECH"}},
    "DI-009": {"STAFF": {"LAB_TECH"}},
    "DI-011": {"STAFF": {"LAB_REVIEW"}},
    "DI-013": {"PATIENT": set(), "DOCTOR": set()},
    "BI-004": {"PATIENT": set()},
    "BI-005": {"STAFF": {"CASHIER"}},
    "BI-007": {"STAFF": {"CASHIER"}},
    "BI-008": {"STAFF": {"CASHIER"}},
    "CL-009": {"DOCTOR": set()},
    "CL-010": {"DOCTOR": set()},
    "CL-011": {"DOCTOR": set(), "PATIENT": set()},
    "IA-012": {"STAFF": {"ADMIN"}},
}


def can_issue_lease(actor, capabilities, action):
    allowed = POLICY.get(action, {})
    if actor not in allowed:
        return False
    return not allowed[actor] or bool(set(capabilities).intersection(allowed[actor]))

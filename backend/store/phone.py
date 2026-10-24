"""Kyrgyz phone number normalization.

Accepted inputs (spaces, dashes and parentheses are ignored):
"+996 555 123 456", "996555123456", "0555 123 456", "555123456".
Everything is stored as "+996" followed by the 9-digit national number.
"""

import re

PHONE_ERROR = "Введите номер телефона Кыргызстана: +996 и 9 цифр, например +996 555 123 456."

_SEPARATORS = re.compile(r"[\s\-()]")


class InvalidPhone(ValueError):
    pass


def normalize_kg_phone(raw: str | None) -> str:
    """Return the phone as "+996XXXXXXXXX" or raise InvalidPhone."""
    if not raw:
        raise InvalidPhone(PHONE_ERROR)
    compact = _SEPARATORS.sub("", raw)
    if compact.startswith("+"):
        if not compact.startswith("+996"):
            raise InvalidPhone(PHONE_ERROR)
        national = compact[4:]
    elif len(compact) == 12 and compact.startswith("996"):
        national = compact[3:]
    elif len(compact) == 10 and compact.startswith("0"):
        national = compact[1:]
    else:
        national = compact
    if len(national) != 9 or not (national.isascii() and national.isdigit()):
        raise InvalidPhone(PHONE_ERROR)
    if national.startswith("0"):
        raise InvalidPhone(PHONE_ERROR)
    return "+996" + national

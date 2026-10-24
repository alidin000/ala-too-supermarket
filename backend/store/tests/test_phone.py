from django.test import SimpleTestCase

from ..phone import InvalidPhone, normalize_kg_phone


class PhoneNormalizationTests(SimpleTestCase):
    def test_accepted_formats_normalize_to_plus_996(self):
        accepted = [
            "+996 555 123 456",
            "996555123456",
            "0555 123 456",
            "555123456",
            "+996 (555) 12-34-56",
            "0 (555) 123-456",
            "+996-555-123-456",
            " +996 555 123 456 ",  # pasted from a phone's contact card
        ]
        for raw in accepted:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_kg_phone(raw), "+996555123456")

    def test_rejected_inputs(self):
        rejected = [
            "",
            None,
            "12345",
            "+7 701 123 4567",  # Kazakhstan
            "8 555 123 456",  # Soviet-style trunk prefix
            "+996 055 123 456",  # national number cannot start with 0
            "+996 555 123 45",  # 8 digits
            "+996 555 123 4567",  # 10 digits
            "+9960555123456",
            "00996555123456",
            "555.123.456",  # dots are not an accepted separator
            "+996 555 １23 456",  # full-width digit
            "+996 555 123 456 доб. 2",
            "телефон",
        ]
        for raw in rejected:
            with self.subTest(raw=raw), self.assertRaises(InvalidPhone):
                normalize_kg_phone(raw)

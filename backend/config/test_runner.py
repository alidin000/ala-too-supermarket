"""Test runner that makes ``manage.py test`` independent of the deploy environment."""

import warnings

from django.conf import settings
from django.test.runner import DiscoverRunner
from django.test.utils import override_settings


class TestRunner(DiscoverRunner):
    """Django's runner with a few test-only overrides.

    - Plain static storage: the production manifest storage raises on any page that uses
      ``{% static %}`` (Django admin) until ``collectstatic`` has run.
    - No HTTPS redirect: the test client speaks plain HTTP, so with production settings
      every request would get a 301 instead of reaching the view.
    - A fast password hasher, so tests that create users stay quick.
    - No WhiteNoise warning about the missing ``staticfiles/`` folder, which only exists
      after ``collectstatic``.
    """

    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        self._test_settings = override_settings(
            STORAGES={
                **settings.STORAGES,
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            },
            SECURE_SSL_REDIRECT=False,
            PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
        )
        self._test_settings.enable()
        warnings.filterwarnings("ignore", message="No directory at: ", category=UserWarning)

    def teardown_test_environment(self, **kwargs):
        self._test_settings.disable()
        super().teardown_test_environment(**kwargs)

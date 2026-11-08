"""Run one owner's actual Django suite; SQLite is opt-in and only unit evidence."""
import argparse
import os
import sys
from pathlib import Path


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("service", choices=("identity", "billing", "notification"))
    parser.add_argument("--sqlite", action="store_true")
    parser.add_argument("labels", nargs="*")
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "services" / args.service))
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
    from django.conf import settings

    if args.sqlite:
        settings.DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
    elif not os.environ.get(args.service.upper() + "_DB_NAME", "").startswith("umc_be_test_"):
        raise SystemExit("Live Django tests require an isolated umc_be_test_* database.")
    import django

    django.setup()
    os.chdir(root / "services" / args.service)
    from django.test.runner import DiscoverRunner

    runner = DiscoverRunner(interactive=False, verbosity=1, top_level=str(root / "services" / args.service))
    labels = args.labels or [str(root / "services" / args.service / "tests")]
    if runner.build_suite(labels).countTestCases() == 0:
        raise SystemExit("No tests discovered: refusing a green empty gate.")
    raise SystemExit(bool(runner.run_tests(labels)))


if __name__ == "__main__":
    main()


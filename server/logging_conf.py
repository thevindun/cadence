import logging
import os
import sys


def setup():
    level = os.environ.get("CADENCE_LOG_LEVEL", "INFO").upper()
    root = logging.getLogger()
    if root.handlers:                       # uvicorn --reload re-imports; don't stack handlers
        return logging.getLogger("cadence")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)-12s %(message)s", datefmt="%H:%M:%S"
    ))
    root.addHandler(handler)
    root.setLevel(level)
    logging.getLogger("httpx").setLevel(logging.WARNING)      # httpx logs every request
    return logging.getLogger("cadence")


log = setup()
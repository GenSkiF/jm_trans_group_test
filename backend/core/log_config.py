import logging
import sys


def setup_logging():
    logger = logging.getLogger()
    # Только INFO и выше! (можно WARNING для продакшена)
    logger.setLevel(logging.INFO)
    if not logger.hasHandlers():
        console_handler = logging.StreamHandler(sys.stdout)
        file_handler = logging.FileHandler("server.log", encoding="utf-8")
        formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s')
        console_handler.setFormatter(formatter)
        file_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
        logger.addHandler(file_handler)

    # Отключаем лишний шум от сторонних библиотек:
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)
    logging.getLogger("websockets.client").setLevel(logging.WARNING)
    logging.getLogger("websockets.server").setLevel(logging.WARNING)


def log_message(msg, level="info"):
    getattr(logging, level)(msg)

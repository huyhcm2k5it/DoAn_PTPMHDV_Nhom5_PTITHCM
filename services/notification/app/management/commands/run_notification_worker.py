from django.core.management.base import BaseCommand
from app.worker.consumer import start_consumer

class Command(BaseCommand):
    help = "Chạy RabbitMQ Consumer cho Notification Service (evt.notification.v1)"

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("Đang khởi động Notification Worker..."))
        start_consumer()
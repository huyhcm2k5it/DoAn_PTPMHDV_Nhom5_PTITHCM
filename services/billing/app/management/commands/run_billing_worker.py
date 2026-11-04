from django.core.management.base import BaseCommand
from app.worker.consumer import start_consumer

class Command(BaseCommand):
    help = "Chạy RabbitMQ Consumer và Settlement Saga Worker cho Billing Service"

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("Đang khởi động Billing Worker..."))
        start_consumer()
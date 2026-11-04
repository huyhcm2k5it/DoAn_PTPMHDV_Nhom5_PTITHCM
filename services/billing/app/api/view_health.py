from rest_framework.decorators import api_view
from rest_framework.response import Response

@api_view(["GET"])
def health_ready(request):
    """Health check endpoint kiểm tra service đã sẵn sàng nhận traffic."""
    return Response({"status": "ok", "service": "billing"}, status=200)

@api_view(["GET"])
def health_live(request):
    """Liveness probe endpoint kiểm tra service còn sống."""
    return Response({"status": "ok", "service": "billing"}, status=200)
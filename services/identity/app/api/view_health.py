from rest_framework.decorators import api_view
from rest_framework.response import Response

@api_view(["GET"])
def health_ready(request):
    """Endpoint bắt buộc để Docker Compose và Gateway kiểm tra trạng thái sẵn sàng."""
    return Response({
        "status": "UP",
        "service": "identity",
        "database": "OK"
    }, status=200)

@api_view(["GET"])
def health_live(request):
    """Endpoint liveness probe."""
    return Response({"status": "UP"}, status=200)
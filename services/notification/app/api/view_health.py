from rest_framework.decorators import api_view
from rest_framework.response import Response

@api_view(["GET"])
def health_ready(request):
    return Response({"status": "ready", "service": "notification"}, status=200)

@api_view(["GET"])
def health_live(request):
    return Response({"status": "live", "service": "notification"}, status=200)
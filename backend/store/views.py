from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Category, Order, Product
from .serializers import CategorySerializer, OrderCreateSerializer, OrderSerializer, ProductSerializer

class CategoryListView(generics.ListAPIView):
    queryset = Category.objects.filter(is_active=True)
    serializer_class = CategorySerializer
    permission_classes = [permissions.AllowAny]

class ProductListView(generics.ListAPIView):
    serializer_class = ProductSerializer
    permission_classes = [permissions.AllowAny]
    def get_queryset(self):
        queryset = Product.objects.filter(is_active=True, stock_quantity__gt=0).select_related('category')
        category = self.request.query_params.get('category')
        search = self.request.query_params.get('search')
        if category:
            queryset = queryset.filter(category_id=category)
        if search:
            from django.db.models import Q
            queryset = queryset.filter(Q(name_ru__icontains=search) | Q(name_ky__icontains=search) | Q(sku__icontains=search))
        return queryset

class CreateOrderView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        serializer = OrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)

class OrderStatusView(APIView):
    permission_classes = [permissions.AllowAny]
    def get(self, request, order_id):
        try:
            order = Order.objects.get(pk=order_id)
        except Order.DoesNotExist:
            return Response({'detail':'Order not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'id':order.id,'status':order.status,'payment_status':order.payment_status,'created_at':order.created_at})

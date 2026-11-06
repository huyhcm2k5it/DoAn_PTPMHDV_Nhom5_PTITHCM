package com.umccare.feature.booking

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.umccare.core.network.BillingApi
import com.umccare.core.network.ChargeDto
import com.umccare.core.network.PaymentSimulateRequest
import com.umccare.core.session.SessionManager
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientHomeScreen(
    billingApi: BillingApi,
    sessionManager: SessionManager,
    onLogout: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var charges by remember { mutableStateOf<List<ChargeDto>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var actionMessage by remember { mutableStateOf<String?>(null) }
    var isErrorAction by remember { mutableStateOf(false) }

    // Idempotency Tracking: Lưu cặp (idempotencyKey, transactionId) cho mỗi charge
    val chargeAttempts = remember { mutableStateMapOf<String, Pair<String, String>>() }
    // In-flight Tracking: Danh sách các charge đang trong quá trình gửi request thanh toán
    val inFlightCharges = remember { mutableStateListOf<String>() }

    fun loadCharges() {
        loading = true
        coroutineScope.launch {
            try {
                val res = billingApi.getCharges()
                if (res.isSuccessful && res.body()?.data != null) {
                    charges = res.body()!!.data!!.items
                } else if (res.code() == 401) {
                    sessionManager.clearSession()
                    onLogout()
                } else {
                    charges = emptyList()
                    actionMessage = "Tải viện phí thất bại (${res.code()})"
                    isErrorAction = true
                }
            } catch (e: Exception) {
                charges = emptyList()
                actionMessage = "Lỗi tải viện phí: ${e.localizedMessage}"
                isErrorAction = true
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadCharges()
    }

    fun handlePayment(charge: ChargeDto) {
        if (inFlightCharges.contains(charge.id)) return
        inFlightCharges.add(charge.id)

        // Tái sử dụng cùng idempotencyKey và transactionId cho đến khi có kết quả dứt khoát
        val (idempotencyKey, txId) = chargeAttempts.getOrPut(charge.id) {
            UUID.randomUUID().toString() to "SIM-APP-${System.currentTimeMillis()}"
        }

        coroutineScope.launch {
            try {
                val res = billingApi.simulatePayment(
                    idempotencyKey = idempotencyKey,
                    req = PaymentSimulateRequest(charge.id, txId)
                )
                if (res.code() == 202) {
                    actionMessage = "Đã gửi thanh toán (202 Accepted). Đang đối soát..."
                    isErrorAction = false
                    chargeAttempts.remove(charge.id)
                    kotlinx.coroutines.delay(2000)
                    loadCharges()
                } else if (res.code() == 401) {
                    sessionManager.clearSession()
                    onLogout()
                } else {
                    actionMessage = "Thanh toán thất bại (${res.code()})"
                    isErrorAction = true
                }
            } catch (e: Exception) {
                actionMessage = "Lỗi thanh toán: ${e.localizedMessage}"
                isErrorAction = true
            } finally {
                inFlightCharges.remove(charge.id)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("UMC Care · Bệnh nhân", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                ),
                actions = {
                    IconButton(onClick = { loadCharges() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Tải lại")
                    }
                    IconButton(onClick = {
                        sessionManager.clearSession()
                        onLogout()
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Đăng xuất")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .padding(16.dp)
        ) {
            actionMessage?.let { msg ->
                Surface(
                    color = if (isErrorAction) Color(0xFFFFEBEE) else Color(0xFFE8F5E9),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp)
                ) {
                    Text(
                        text = msg,
                        color = if (isErrorAction) Color(0xFFC62828) else Color(0xFF2E7D32),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            Text(
                text = "Khoản thu viện phí & Lịch hẹn",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF263238),
                modifier = Modifier.padding(bottom = 12.dp)
            )

            if (loading) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (charges.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Hiện chưa có khoản thu viện phí nào.", color = Color.Gray)
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(charges) { charge ->
                        ChargeCard(
                            charge = charge,
                            isProcessing = inFlightCharges.contains(charge.id),
                            onPayClick = { handlePayment(charge) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ChargeCard(
    charge: ChargeDto,
    isProcessing: Boolean,
    onPayClick: () -> Unit
) {
    val formatter = NumberFormat.getCurrencyInstance(Locale("vi", "VN"))
    val isPaid = charge.state == "PAID"

    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = formatter.format(charge.amountVnd),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
                Surface(
                    color = if (isPaid) Color(0xFFE8F5E9) else Color(0xFFFFF3E0),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Text(
                        text = charge.state,
                        color = if (isPaid) Color(0xFF2E7D32) else Color(0xFFE65100),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text(text = "Mã khoản thu: ${charge.id}", fontSize = 12.sp, color = Color.Gray)
            charge.settlementState?.let {
                Text(text = "Đối soát Saga: $it", fontSize = 12.sp, color = Color.DarkGray)
            }

            if (!isPaid) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onPayClick,
                    enabled = !isProcessing,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (isProcessing) {
                        CircularProgressIndicator(
                            color = Color.White,
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Đang xử lý...")
                    } else {
                        Text("Thanh toán viện phí ngay")
                    }
                }
            }
        }
    }
}

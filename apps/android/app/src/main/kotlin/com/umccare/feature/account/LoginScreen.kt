package com.umccare.feature.account

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.SecurityUpdateGood
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.umccare.R
import com.umccare.core.network.AuthApi
import com.umccare.core.network.LoginRequest
import com.umccare.core.session.SessionManager
import kotlinx.coroutines.launch

private val BrandBlue = Color(0xFF1764D5)
private val TextDark = Color(0xFF142D4D)
private val TextMuted = Color(0xFF62738B)
private val BorderStroke = Color(0xFFE2E8F1)
private val InputBg = Color(0xFFFFFFFF)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    authApi: AuthApi,
    sessionManager: SessionManager,
    onLoginSuccess: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(scrollState)
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth()
        ) {
            Spacer(modifier = Modifier.height(20.dp))

            // 1. Logo chữ thập y tế UMC CARE (Lấy từ Figma 3:4041)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxWidth()
            ) {
                Image(
                    painter = painterResource(id = R.drawable.ic_medical_cross),
                    contentDescription = "UMC Logo",
                    modifier = Modifier
                        .size(42.dp)
                        .clip(RoundedCornerShape(12.dp))
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = "UMC CARE",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    color = BrandBlue,
                    letterSpacing = (-0.6).sp
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            // 2. Ảnh minh họa hộp y tế chăm sóc sức khỏe (Lấy từ Figma 3:4045)
            Image(
                painter = painterResource(id = R.drawable.img_healthcare_banner),
                contentDescription = "Minh họa chăm sóc sức khỏe",
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(156.dp)
                    .clip(RoundedCornerShape(24.dp))
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 3. Khối Tiêu đề Chào mừng
            Text(
                text = "Chào mừng trở lại!",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = TextDark,
                textAlign = TextAlign.Center,
                letterSpacing = (-0.8).sp
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Đăng nhập để đặt lịch và quản lý\nthông tin khám bệnh của bạn.",
                fontSize = 14.sp,
                color = TextMuted,
                textAlign = TextAlign.Center,
                lineHeight = 21.sp
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Banner lỗi nếu có
            errorMessage?.let { error ->
                Surface(
                    color = Color(0xFFFFEBEE),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp)
                ) {
                    Text(
                        text = error,
                        color = Color(0xFFC62828),
                        fontSize = 13.sp,
                        modifier = Modifier.padding(12.dp),
                        textAlign = TextAlign.Center
                    )
                }
            }

            // 4. Form: Số điện thoại
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Số điện thoại",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextDark,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    placeholder = { Text("0912 345 678", color = Color(0xFFA0AEC0)) },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Phone,
                            contentDescription = null,
                            tint = TextMuted,
                            modifier = Modifier.size(20.dp)
                        )
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = InputBg,
                        unfocusedContainerColor = InputBg,
                        focusedBorderColor = BrandBlue,
                        unfocusedBorderColor = BorderStroke,
                        focusedTextColor = TextDark,
                        unfocusedTextColor = TextDark
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Form: Mật khẩu
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Mật khẩu",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextDark,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = { Text("••••••••••", color = Color(0xFFA0AEC0)) },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            tint = TextMuted,
                            modifier = Modifier.size(20.dp)
                        )
                    },
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(
                                imageVector = if (passwordVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                contentDescription = if (passwordVisible) "Ẩn mật khẩu" else "Hiện mật khẩu",
                                tint = TextMuted,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    },
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = InputBg,
                        unfocusedContainerColor = InputBg,
                        focusedBorderColor = BrandBlue,
                        unfocusedBorderColor = BorderStroke,
                        focusedTextColor = TextDark,
                        unfocusedTextColor = TextDark
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Quên mật khẩu?
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.CenterEnd
            ) {
                Text(
                    text = "Quên mật khẩu?",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = BrandBlue,
                    modifier = Modifier
                        .clickable { /* Quên mật khẩu */ }
                        .padding(vertical = 4.dp)
                )
            }

            Spacer(modifier = Modifier.height(18.dp))

            // Nút bấm Đăng nhập
            Button(
                onClick = {
                    loading = true
                    errorMessage = null
                    coroutineScope.launch {
                        try {
                            val response = authApi.login(LoginRequest(phone.trim(), password))
                            if (response.isSuccessful && response.body()?.data != null) {
                                val authData = response.body()!!.data!!
                                sessionManager.saveTokens(
                                    accessToken = authData.accessToken,
                                    refreshToken = authData.refreshToken,
                                    userId = "patient-user",
                                    actorType = authData.actorType
                                )
                                onLoginSuccess()
                            } else {
                                val errBodyStr = response.errorBody()?.string()
                                val parsedError = try {
                                    if (!errBodyStr.isNullOrBlank()) {
                                        com.google.gson.Gson().fromJson(errBodyStr, com.umccare.core.network.AuthResponse::class.java)
                                    } else null
                                } catch (_: Exception) {
                                    null
                                }
                                errorMessage = parsedError?.error?.message ?: response.body()?.error?.message
                                    ?: "Số điện thoại hoặc mật khẩu không đúng."
                            }
                        } catch (e: Exception) {
                            errorMessage = "Lỗi kết nối Gateway: ${e.localizedMessage}"
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading && phone.isNotBlank() && password.isNotBlank(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = BrandBlue,
                    disabledContainerColor = BrandBlue.copy(alpha = 0.5f)
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                if (loading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                } else {
                    Text(
                        text = "Đăng nhập",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White
                    )
                }
            }
        }

        // 5. Chân trang: Đăng ký & Chiếc khiên bảo mật (Lấy từ Figma 3:4066)
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 28.dp, bottom = 16.dp)
        ) {
            val signupText = buildAnnotatedString {
                append("Chưa có tài khoản? ")
                withStyle(style = SpanStyle(color = BrandBlue, fontWeight = FontWeight.Bold)) {
                    append("Đăng ký")
                }
            }
            Text(
                text = signupText,
                fontSize = 14.sp,
                color = TextMuted,
                modifier = Modifier.clickable { /* Chuyển trang đăng ký */ }
            )

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Icon(
                    imageVector = Icons.Default.SecurityUpdateGood,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "Thông tin của bạn luôn được bảo mật",
                    fontSize = 11.sp,
                    color = TextMuted
                )
            }
        }
    }
}

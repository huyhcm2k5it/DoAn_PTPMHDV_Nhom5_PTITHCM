package com.umccare.core.network

import com.google.gson.annotations.SerializedName

//Models for Identity
data class LoginRequest(
    val phone: String,
    val password: String
)

data class AuthResponse(
    val data: AuthData?,
    val error: ApiError?,
    val meta: ApiMeta?
)
data class AuthData(
    val accessToken: String,
    val refreshToken: String,
    val actorType: String,
    val expiresInSeconds: Int
)
data class ApiError(
    val code: String,
    val message: String
)
data class ApiMeta(
    val correlationId: String?
)
// Models cho Billing
data class ChargeDto(
    val id: String,
    @SerializedName("amountVnd") val amountVnd: Long,
    val state: String,
    @SerializedName("settlementState") val settlementState: String?,
    @SerializedName("createdAt") val createdAt: String?
)
data class ChargeListResponse(
    val data: ChargeListData?,
    val error: ApiError?,
    val meta: ApiMeta?
)
data class ChargeListData(
    val items: List<ChargeDto>,
    val total: Int
)
data class PaymentSimulateRequest(
    val chargeId: String,
    val transactionId: String
)
data class PaymentSimulateResponse(
    val data: PaymentSimulateData?,
    val error: ApiError?,
    val meta: ApiMeta?
)
data class PaymentSimulateData(
    val requestId: String,
    val paymentId: String,
    val state: String,
    val statusUrl: String
)
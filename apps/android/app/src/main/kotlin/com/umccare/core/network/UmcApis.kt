package com.umccare.core.network

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

interface AuthApi {
    @POST("/api/v1/auth/login")
    suspend fun login(@Body req: LoginRequest): Response<AuthResponse>
}

interface BillingApi {
    @GET("/api/v1/charges")
    suspend fun getCharges(): Response<ChargeListResponse>

    @POST("/api/v1/payments/simulate")
    suspend fun simulatePayment(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body req: PaymentSimulateRequest
    ): Response<PaymentSimulateResponse>
}
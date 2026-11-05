package com.umccare.core.network

import com.umccare.core.session.SessionManager
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    // 10.0.2.2 là địa chỉ IP đặc biệt của Android Emulator để truy cập vào localhost của máy tính host
    private const val GATEWAY_URL = "http://10.0.2.2:8080/"

    private fun createOkHttpClient(sessionManager: SessionManager): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val authInterceptor = Interceptor { chain ->
            val original = chain.request()
            val builder = original.newBuilder()

            // Tự động gắn Bearer Token nếu đã đăng nhập
            sessionManager.getAccessToken()?.let { token ->
                builder.header("Authorization", "Bearer $token")
            }

            chain.proceed(builder.build())
        }

        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    fun getRetrofit(sessionManager: SessionManager): Retrofit {
        return Retrofit.Builder()
            .baseUrl(GATEWAY_URL)
            .client(createOkHttpClient(sessionManager))
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun createAuthApi(sessionManager: SessionManager): AuthApi {
        return getRetrofit(sessionManager).create(AuthApi::class.java)
    }

    fun createBillingApi(sessionManager: SessionManager): BillingApi {
        return getRetrofit(sessionManager).create(BillingApi::class.java)
    }
}
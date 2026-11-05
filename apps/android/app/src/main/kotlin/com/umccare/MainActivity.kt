package com.umccare

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import com.umccare.core.network.ApiClient
import com.umccare.core.session.SessionManager
import com.umccare.core.ui.UMCCareTheme
import com.umccare.feature.account.LoginScreen
import com.umccare.feature.booking.PatientHomeScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sessionManager = SessionManager(this)
        val authApi = ApiClient.createAuthApi(sessionManager)
        val billingApi = ApiClient.createBillingApi(sessionManager)

        setContent {
            UMCCareTheme {
                var isLoggedIn by remember { mutableStateOf(sessionManager.isLoggedIn()) }

                if (isLoggedIn) {
                    PatientHomeScreen(
                        billingApi = billingApi,
                        sessionManager = sessionManager,
                        onLogout = { isLoggedIn = false }
                    )
                } else {
                    LoginScreen(
                        authApi = authApi,
                        sessionManager = sessionManager,
                        onLoginSuccess = { isLoggedIn = true }
                    )
                }
            }
        }
    }
}
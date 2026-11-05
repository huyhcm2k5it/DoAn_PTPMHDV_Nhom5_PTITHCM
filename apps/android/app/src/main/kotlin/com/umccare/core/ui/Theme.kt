package com.umccare.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val MedicalBlue = Color(0xFF0288D1)
val MedicalBlueDark = Color(0xFF01579B)
val MedicalTeal = Color(0xFF00897B)
val BackgroundLight = Color(0xFFF8F9FA)
val SurfaceWhite = Color(0xFFFFFFFF)

private val LightColorScheme = lightColorScheme(
    primary = MedicalBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE1F5FE),
    onPrimaryContainer = MedicalBlueDark,
    secondary = MedicalTeal,
    background = BackgroundLight,
    surface = SurfaceWhite
)

@Composable
fun UMCCareTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = LightColorScheme,
        content = content
    )
}
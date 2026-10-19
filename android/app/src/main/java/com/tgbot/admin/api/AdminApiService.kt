package com.tgbot.admin.api

import retrofit2.Response
import retrofit2.http.*

data class LoginRequest(
    val telegramId: String,
    val password: String
)

data class LoginResponse(
    val success: Boolean,
    val token: String,
    val admin: AdminData
)

data class AdminData(
    val id: String,
    val telegramId: String,
    val name: String,
    val role: String,
    val permissions: Map<String, Boolean>
)

data class ItemDto(
    val id: String,
    val type: String,
    val name: String,
    val triggers: List<String>,
    val triggerType: String,
    val rawKeyword: String,
    val fileName: String?,
    val caption: String?,
    val url: String?,
    val openMode: String?,
    val buttonText: String?,
    val replyMessage: String?,
    val status: String,
    val deliveryCount: Int
)

interface AdminApiService {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @GET("api/items")
    suspend fun getItems(@Header("Authorization") token: String): Response<List<ItemDto>>

    @DELETE("api/items/{id}")
    suspend fun deleteItem(
        @Header("Authorization") token: String,
        @Path("id") id: String
    ): Response<Map<String, Boolean>>
}

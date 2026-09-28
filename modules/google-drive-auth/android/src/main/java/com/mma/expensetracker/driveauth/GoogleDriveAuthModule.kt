package com.mma.expensetracker.driveauth

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

/**
 * A Google OAuth access token, and nothing else.
 *
 * We use no third-party sign-in library. The popular free one wraps
 * `GoogleSignInClient`, which Google has deprecated and will remove from Play
 * Services on an unannounced day; its modern replacement is behind a paid
 * licence. The other is built on Nitro Modules, which needs React Native's New
 * Architecture — and this app runs on the old one, where ML Kit works today.
 * So: a hundred lines against `AuthorizationClient`, the API Google actually
 * points to for OAuth scopes, which was split away from sign-in precisely so it
 * would outlive it.
 *
 * ## Every path says what happened
 *
 * The first version of this file resolved `null` for both "the user closed the
 * picker" and "Play Services refused because this build's signature is not
 * registered". Those look identical on screen — the button does nothing and the
 * status still reads "Not connected" — and they need completely opposite
 * responses from the developer. That cost a debugging round, so nothing here
 * resolves a bare value any more. Every path returns an outcome with a name:
 *
 *   granted   — a token, use it
 *   cancelled — the user backed out; not an error, say nothing
 *   failed    — Google refused, with its status code attached
 *   noResult  — we came back to the foreground and Android never delivered a
 *               result at all, which means the launch itself was swallowed
 *
 * `statusCode` 10 is DEVELOPER_ERROR, and it is the answer nine times out of
 * ten: the SHA-1 of the key that signed this APK is not registered against an
 * Android OAuth client for this package. `signingInfo()` exists so the app can
 * print that fingerprint itself instead of sending someone to keytool.
 */
class GoogleDriveAuthModule : Module() {

  /** The promise waiting on the consent screen, if one is open. */
  private var pending: Promise? = null

  private val activity: Activity
    get() = appContext.currentActivity
      ?: throw CodedException("E_NO_ACTIVITY", "No foreground activity", null)

  override fun definition() = ModuleDefinition {
    Name("GoogleDriveAuth")

    /**
     * Ask for a token, showing the account picker and consent screen if the
     * user has not been through them yet.
     */
    AsyncFunction("authorize") { scopes: List<String>, promise: Promise ->
      request(scopes, interactive = true, promise = promise)
    }

    /**
     * Ask for a token without ever showing UI. Reports `cancelled` when consent
     * is needed. This is the one the scheduled backup calls: a backup that
     * ambushes you with a Google consent screen on app start is a bug.
     */
    AsyncFunction("authorizeSilently") { scopes: List<String>, promise: Promise ->
      request(scopes, interactive = false, promise = promise)
    }

    /**
     * Open the Google Picker so the user can hand this app one specific file
     * that somebody else owns.
     *
     * This is the only way `drive.file` ever reaches a file this app did not
     * create. The scope grants access to files the app creates *or* that "the
     * user shares with an app while using the Google Picker API" — and that
     * second half includes modifying them, which is what makes office mode
     * possible at all: the owner creates a file in their own Drive, shares it
     * with a staff member as a writer, and the staff member's copy of the app
     * picks it once and can append to it forever.
     *
     * Implemented as a resource parameter on the ordinary authorization
     * request rather than as a separate API. Google added
     * `PICKER_OAUTH_TRIGGER` in play-services-auth **21.6.0**; anything older
     * will not compile, which is the good kind of failure.
     *
     * Note `setOptOutIncludingGrantedScopes(true)`: without it, an account
     * that has already granted `drive.file` gets a token straight back and the
     * picker never appears — there would be nothing to resolve, so nothing to
     * show. The whole point here is to force the UI.
     */
    AsyncFunction("pickFiles") { options: Map<String, Any?>, promise: Promise ->
      pick(options, promise)
    }

    /**
     * How this exact build identifies itself to Google.
     *
     * The single most common reason Drive sign-in fails is that the SHA-1 in
     * the Cloud Console belongs to a different keystore than the one that
     * signed the APK now running — debug versus release, or your release key
     * versus the one Play App Signing re-signed with. Reading it off the
     * installed app removes all of that guesswork.
     */
    // Returns a plain map of strings rather than a nullable object: an empty
    // fingerprint is a state the screen can render ("couldn't read it"),
    // whereas a null crossing the bridge is one more thing to get wrong.
    Function("signingInfo") { readSigningInfo() }

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQUEST_CODE) {
        onConsentResult(payload.resultCode, payload.data)
      }
    }

    /**
     * Safety net for a result that never arrives.
     *
     * Android delivers onActivityResult before onResume, so if we are back in
     * the foreground with a promise still waiting, no result was delivered at
     * all — a swallowed launch, or a process death and restart. Without this
     * the promise hangs forever and the screen spins with no explanation.
     */
    OnActivityEntersForeground {
      val promise = pending ?: return@OnActivityEntersForeground
      pending = null
      promise.resolve(outcome("noResult"))
    }
  }

  private fun request(scopes: List<String>, interactive: Boolean, promise: Promise) {
    if (pending != null) {
      promise.reject(CodedException("E_IN_PROGRESS", "A sign-in is already open", null))
      return
    }

    val request = AuthorizationRequest.builder()
      .setRequestedScopes(scopes.map { Scope(it) })
      .build()

    Identity.getAuthorizationClient(activity)
      .authorize(request)
      .addOnSuccessListener { result ->
        if (!result.hasResolution()) {
          // Already granted on a previous run — a token comes straight back.
          val token = result.accessToken
          if (token != null) {
            promise.resolve(outcome("granted", token = token))
          } else {
            // Google said yes and handed over nothing. Never seen in practice,
            // but resolving a bare null here is exactly the silence this
            // module exists to avoid.
            promise.resolve(outcome("failed", message = "Google returned no access token"))
          }
          return@addOnSuccessListener
        }

        // Google wants to show the account picker or the consent screen.
        if (!interactive) {
          promise.resolve(outcome("cancelled"))
          return@addOnSuccessListener
        }

        val intent = result.pendingIntent
        if (intent == null) {
          promise.resolve(outcome("failed", message = "Consent needed but not offered"))
          return@addOnSuccessListener
        }

        pending = promise
        try {
          activity.startIntentSenderForResult(
            intent.intentSender, REQUEST_CODE, null, 0, 0, 0, null
          )
        } catch (e: Throwable) {
          pending = null
          promise.resolve(outcome("failed", message = e.message ?: "Could not open the consent screen"))
        }
      }
      .addOnFailureListener { e ->
        promise.resolve(
          outcome(
            "failed",
            code = (e as? ApiException)?.statusCode,
            message = e.message ?: "Google refused the request"
          )
        )
      }
  }

  /**
   * The picker variant of `request`.
   *
   * Deliberately a separate function rather than a flag on `request`: the
   * picker always needs UI, always forces consent, and always carries resource
   * parameters, so folding it into the silent/interactive path would mean
   * three conditionals in a function whose whole job is to be readable.
   */
  private fun pick(options: Map<String, Any?>, promise: Promise) {
    if (pending != null) {
      promise.reject(CodedException("E_IN_PROGRESS", "A sign-in is already open", null))
      return
    }

    val builder = AuthorizationRequest.builder()
      .setRequestedScopes(listOf(Scope(DRIVE_FILE_SCOPE)))
      // Force the UI. See the note on the AsyncFunction above.
      .setOptOutIncludingGrantedScopes(true)
      .setPrompt(AuthorizationRequest.Prompt.CONSENT or AuthorizationRequest.Prompt.SELECT_ACCOUNT)
      .addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_OAUTH_TRIGGER, "true")

    if (options["allowMultiple"] == true) {
      builder.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_ALLOW_MULTIPLE, "true")
    }
    (options["mimeTypes"] as? String)?.takeIf { it.isNotBlank() }?.let {
      builder.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_MIMETYPES, it)
    }
    // Narrowing to the exact files the employer shared turns "find the right
    // one among four hundred" into "tap the one thing on the screen".
    (options["fileIds"] as? String)?.takeIf { it.isNotBlank() }?.let {
      builder.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_FILE_IDS, it)
    }
    if (options["allowFolders"] == true) {
      builder.addResourceParameter(
        AuthorizationRequest.ResourceParameter.PICKER_ALLOW_FOLDER_SELECTION, "true"
      )
    }

    Identity.getAuthorizationClient(activity)
      .authorize(builder.build())
      .addOnSuccessListener { result ->
        if (!result.hasResolution()) {
          // No UI to show. With optOutIncludingGrantedScopes set this should
          // not happen, and if it does there are no picked files, so say so
          // rather than reporting a success with nothing in it.
          promise.resolve(
            outcome("failed", message = "Google returned no picker to show")
          )
          return@addOnSuccessListener
        }

        val intent = result.pendingIntent
        if (intent == null) {
          promise.resolve(outcome("failed", message = "Picker needed but not offered"))
          return@addOnSuccessListener
        }

        pending = promise
        try {
          activity.startIntentSenderForResult(
            intent.intentSender, REQUEST_CODE, null, 0, 0, 0, null
          )
        } catch (e: Throwable) {
          pending = null
          promise.resolve(
            outcome("failed", message = e.message ?: "Could not open the picker")
          )
        }
      }
      .addOnFailureListener { e ->
        promise.resolve(
          outcome(
            "failed",
            code = (e as? ApiException)?.statusCode,
            message = e.message ?: "Google refused the picker request"
          )
        )
      }
  }

  /**
   * Pull the picked file ids out of the authorization result.
   *
   * Google documents the value as arriving in `getTokenResponseParams()` under
   * `picked_file_ids`, and the web flow delivers it as a comma-separated
   * string. Both shapes are handled because a Bundle can legitimately carry
   * either, and guessing wrong would mean a join flow that silently picks
   * nothing.
   */
  private fun pickedFileIds(result: AuthorizationResult): List<String> {
    val params = try {
      result.tokenResponseParams
    } catch (e: Throwable) {
      null
    } ?: return emptyList()

    params.getStringArrayList(PICKED_FILE_IDS)?.let { return it.filter { id -> id.isNotBlank() } }

    return params.getString(PICKED_FILE_IDS)
      ?.split(',')
      ?.map { it.trim() }
      ?.filter { it.isNotEmpty() }
      ?: emptyList()
  }

  /**
   * Back from the consent screen.
   *
   * RESULT_CANCELED is the ambiguous one: Android reports it both when the user
   * pressed back and when Play Services aborted the flow because this app's
   * signature is not registered. Picking an account and landing here is the
   * classic shape of the second, so the result carries the raw code and lets
   * the app above decide what to say.
   */
  private fun onConsentResult(resultCode: Int, data: Intent?) {
    val promise = pending ?: return
    pending = null

    if (resultCode != Activity.RESULT_OK) {
      promise.resolve(outcome("cancelled", code = resultCode, afterConsent = true))
      return
    }

    if (data == null) {
      promise.resolve(
        outcome("failed", message = "Google returned an empty result", afterConsent = true)
      )
      return
    }

    try {
      val result: AuthorizationResult =
        Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)
      val token = result.accessToken
      // Read on every path, not just the picker's: an ordinary authorization
      // simply comes back with an empty list, and one result shape is one
      // fewer thing for the JS side to branch on.
      val picked = pickedFileIds(result)
      if (token != null) {
        promise.resolve(outcome("granted", token = token, pickedFileIds = picked))
      } else {
        promise.resolve(
          outcome("failed", message = "Google returned no access token", pickedFileIds = picked)
        )
      }
    } catch (e: Throwable) {
      promise.resolve(
        outcome(
          "failed",
          code = (e as? ApiException)?.statusCode,
          message = e.message ?: "Could not read the result",
          afterConsent = true
        )
      )
    }
  }

  /**
   * `afterConsent` is the one that matters for diagnosis.
   *
   * A cancel before anything was shown means the request never got off the
   * ground. A cancel AFTER the account picker and consent screen ran means the
   * user either pressed back — or Play Services quietly aborted the flow
   * because this build's signature is not registered against an OAuth client.
   * Android reports both as a bare RESULT_CANCELED with no status code, so the
   * two are indistinguishable down here. Passing up the fact that the consent
   * flow actually ran is what lets the screen above say something useful
   * instead of nothing at all.
   */
  private fun outcome(
    outcome: String,
    token: String? = null,
    code: Int? = null,
    message: String? = null,
    afterConsent: Boolean = false,
    pickedFileIds: List<String> = emptyList()
  ): Map<String, Any?> = mapOf(
    "outcome" to outcome,
    "token" to token,
    "code" to code,
    "message" to message,
    "afterConsent" to afterConsent,
    "pickedFileIds" to pickedFileIds
  )

  /**
   * Package name and signing fingerprints of the APK actually running.
   *
   * Both values come back empty rather than absent when they cannot be read, so
   * the caller has one shape to handle instead of two.
   */
  private fun readSigningInfo(): Map<String, String> {
    val context = appContext.reactContext
      ?: return mapOf("packageName" to "", "sha1" to "", "sha256" to "")
    val pkg = context.packageName

    val signature = try {
      val pm = context.packageManager
      val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures
      }
      signatures?.firstOrNull()
    } catch (e: Throwable) {
      null
    }

    if (signature == null) return mapOf("packageName" to pkg, "sha1" to "", "sha256" to "")

    return mapOf(
      "packageName" to pkg,
      "sha1" to fingerprint(signature.toByteArray(), "SHA-1"),
      "sha256" to fingerprint(signature.toByteArray(), "SHA-256")
    )
  }

  private fun fingerprint(cert: ByteArray, algorithm: String): String =
    MessageDigest.getInstance(algorithm)
      .digest(cert)
      .joinToString(":") { "%02X".format(it) }

  companion object {
    /** Arbitrary, only has to be unique within this activity. */
    const val REQUEST_CODE = 0x0D12

    /**
     * The only scope this app ever asks for — and, in the picker flow, the only
     * one Google permits: its documentation states `drive.file` "can't be
     * combined with any other scope" there.
     */
    const val DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"

    /** Key Google puts the picked ids under in the token response bundle. */
    const val PICKED_FILE_IDS = "picked_file_ids"
  }
}

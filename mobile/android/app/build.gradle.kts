import java.io.FileInputStream
import java.security.KeyStore

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val webAssetsDir = providers.gradleProperty("wheelmakerWebAssetsDir")
    .orElse(System.getenv("WHEELMAKER_ANDROID_WEB_ASSETS") ?: "")
    .get()

val requestedAndroidTasks = gradle.startParameter.taskNames.map { it.substringAfterLast(':').lowercase() }
val releasePackagingTask = Regex("^(assemble|bundle|package|sign|publish|install).*release.*$")
val releaseBuildRequested = requestedAndroidTasks.any { taskName ->
	releasePackagingTask.matches(taskName) ||
        taskName == "assemble" ||
        taskName == "build" ||
		taskName == "bundle"
}
val releaseSigningEnvironmentNames = listOf(
    "WHEELMAKER_ANDROID_KEYSTORE",
    "WHEELMAKER_ANDROID_STORE_PASSWORD",
    "WHEELMAKER_ANDROID_KEY_ALIAS",
    "WHEELMAKER_ANDROID_KEY_PASSWORD"
)
val releaseSigningValues = if (releaseBuildRequested) {
    val values = releaseSigningEnvironmentNames.associateWith { name ->
        System.getenv(name)?.trim().orEmpty()
    }
    val missing = values.filterValues { it.isBlank() }.keys
    if (missing.isNotEmpty()) {
        throw GradleException("Android release signing is missing required environment variables: ${missing.joinToString()}")
    }
    val keyStoreFile = file(values.getValue("WHEELMAKER_ANDROID_KEYSTORE"))
    if (!keyStoreFile.isFile) {
        throw GradleException("Android release keystore does not exist")
    }
    val storePassword = values.getValue("WHEELMAKER_ANDROID_STORE_PASSWORD")
    val keyAlias = values.getValue("WHEELMAKER_ANDROID_KEY_ALIAS")
    val keyPassword = values.getValue("WHEELMAKER_ANDROID_KEY_PASSWORD")
    val preferredType = when (keyStoreFile.extension.lowercase()) {
        "p12", "pfx" -> "PKCS12"
        else -> "JKS"
    }
    val keyStoreTypes = listOf(preferredType, "JKS", "PKCS12").distinct()
    val validKey = keyStoreTypes.any { keyStoreType ->
        runCatching {
            val keyStore = KeyStore.getInstance(keyStoreType)
            FileInputStream(keyStoreFile).use { input ->
                keyStore.load(input, storePassword.toCharArray())
            }
            require(keyStore.containsAlias(keyAlias))
            require(keyStore.getCertificate(keyAlias) != null)
            require(keyStore.getKey(keyAlias, keyPassword.toCharArray()) != null)
        }.isSuccess
    }
    if (!validKey) {
        throw GradleException("Android release keystore, alias, or password is invalid")
    }
    values
} else {
    emptyMap()
}

android {
    namespace = "com.wheelmaker.android"
    compileSdk = 36

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.wheelmaker.android"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    sourceSets {
        getByName("main") {
            if (webAssetsDir.isNotBlank()) {
                assets.srcDir(webAssetsDir)
            }
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    signingConfigs {
        if (releaseBuildRequested) {
            create("wheelmakerRelease") {
                storeFile = file(releaseSigningValues.getValue("WHEELMAKER_ANDROID_KEYSTORE"))
                storePassword = releaseSigningValues.getValue("WHEELMAKER_ANDROID_STORE_PASSWORD")
                keyAlias = releaseSigningValues.getValue("WHEELMAKER_ANDROID_KEY_ALIAS")
                keyPassword = releaseSigningValues.getValue("WHEELMAKER_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
			if (releaseBuildRequested) {
				signingConfig = signingConfigs.getByName("wheelmakerRelease")
			}
            isMinifyEnabled = false
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
	implementation("androidx.core:core-ktx:1.18.0")
	implementation("androidx.webkit:webkit:1.15.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

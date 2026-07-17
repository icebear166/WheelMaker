import java.io.FileInputStream
import java.security.KeyStore
import java.util.Properties

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
val releaseVersionName = providers.gradleProperty("wheelmakerReleaseVersionName").orNull
val releaseVersionCode = providers.gradleProperty("wheelmakerReleaseVersionCode").orNull?.toIntOrNull()
val releaseSigningValues = if (releaseBuildRequested) {
    if (releaseVersionName.isNullOrBlank() || releaseVersionCode == null || releaseVersionCode <= 0) {
        throw GradleException("Android release version properties are missing or invalid")
    }
    val signingFile = rootProject.file("signing/signing.properties")
    if (!signingFile.isFile) {
        throw GradleException("Android release signing properties do not exist")
    }
    val properties = Properties().apply {
        FileInputStream(signingFile).use { load(it) }
    }
    val propertyNames = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    val values = propertyNames.associateWith { name -> properties.getProperty(name).orEmpty() }
    val missing = values.filterValues { it.isEmpty() }.keys
    if (missing.isNotEmpty()) {
        throw GradleException("Android release signing properties are missing: ${missing.joinToString()}")
    }
    val keyStoreFile = signingFile.parentFile.resolve(values.getValue("storeFile"))
    if (!keyStoreFile.isFile) {
        throw GradleException("Android release keystore does not exist")
    }
    val storePassword = values.getValue("storePassword")
    val keyAlias = values.getValue("keyAlias")
    val keyPassword = values.getValue("keyPassword")
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
    values + ("keyStorePath" to keyStoreFile.absolutePath)
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
        versionCode = if (releaseBuildRequested) releaseVersionCode!! else 1
        versionName = if (releaseBuildRequested) releaseVersionName!! else "0.0.1"
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
                storeFile = file(releaseSigningValues.getValue("keyStorePath"))
                storePassword = releaseSigningValues.getValue("storePassword")
                keyAlias = releaseSigningValues.getValue("keyAlias")
                keyPassword = releaseSigningValues.getValue("keyPassword")
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

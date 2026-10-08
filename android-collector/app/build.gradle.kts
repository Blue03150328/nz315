plugins { id("com.android.application"); kotlin("android") }
android {
    namespace = "cn.nz315.collector"
    compileSdk = 35
    defaultConfig {
        applicationId = "cn.nz315.collector"
        minSdk = 26
        targetSdk = 35
        versionCode = providers.gradleProperty("collectorVersionCode").getOrElse("2").toInt()
        versionName = providers.gradleProperty("collectorVersionName").getOrElse("1.1.0")
    }
    signingConfigs {
        create("localRelease") {
            val path = System.getenv("NZ315_KEYSTORE_PATH")
            if (path != null) {
                storeFile = file(path)
                storePassword = System.getenv("NZ315_STORE_PASSWORD")
                keyAlias = "nz315-collector"
                keyPassword = System.getenv("NZ315_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("localRelease") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(project(":core"))
    implementation(project(":data"))
    implementation(project(":scanner"))
    implementation(project(":export"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

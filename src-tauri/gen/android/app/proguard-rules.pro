# Keep WebKit and JavaScript interfaces
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep native methods for JNI
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep Models and ViewBinding
-keep class com.mydiary.app.** { *; }

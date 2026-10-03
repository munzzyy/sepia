# The page calls these by name through SepiaBridge; losing a name breaks the bridge silently.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

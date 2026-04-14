# WebView JS interface
-keepclassmembers class de.schichtwecker.app.WebAppInterface {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class de.schichtwecker.app.WebAppInterface {
    public *;
}
-keep class de.schichtwecker.app.WebAppInterface { *; }
-keep class de.schichtwecker.app.AlarmReceiver { *; }
-keep class de.schichtwecker.app.AlarmActivity { *; }
-keep class de.schichtwecker.app.MainActivity { *; }

# Preserve line numbers for debugging
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
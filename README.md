This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Backend API

The Flask and PostgreSQL backend is in [`backend/`](backend/README.md). It uses Python with the `psycopg` PostgreSQL driver. Start it from the repository root with:

```powershell
cd backend
py -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python app.py
```

Configure the PostgreSQL connection in `backend/.env` before starting the API.

# Android Play Store release

The Android application ID is `com.autoledger.app`. Create a Google Play Console app with this exact ID, enroll in Play App Signing, and create a private upload key. Keep the key file and its passwords outside the repository; `.keystore` and `.p12` files are ignored by Git.

Generate an upload key with Java's `keytool` from a secure folder:

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore autoledger-upload-key.p12 -alias autoledger-upload -keyalg RSA -keysize 2048 -validity 10000
```

Add these entries to `%USERPROFILE%\.gradle\gradle.properties` (create the file if needed), using the actual path and values chosen when generating the key:

```properties
AUTOLEDGER_UPLOAD_STORE_FILE=D:/secure-keys/autoledger-upload-key.p12
AUTOLEDGER_UPLOAD_STORE_PASSWORD=your-store-password
AUTOLEDGER_UPLOAD_KEY_ALIAS=autoledger-upload
AUTOLEDGER_UPLOAD_KEY_PASSWORD=your-key-password
```

Build the signed Android App Bundle from the repository root:

```powershell
cd android
.\gradlew.bat bundleRelease
```

Upload `android/app/build/outputs/bundle/release/app-release.aab` in Play Console. Before each later release, increment `versionCode` in `android/app/build.gradle` (starting at `2` after the first upload).

Before submitting, complete the store listing, content rating, Data safety form, and privacy policy. This app requests `READ_SMS` to detect bank payment alerts. Google Play restricts SMS permissions: declare the financial-transaction use in Play Console and submit it for review; approval is not guaranteed. If the permission is rejected, remove the SMS auto-record feature and permission before publishing.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.

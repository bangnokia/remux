import type React from "react";
import * as RN from "react-native";
import {
  SafeAreaProvider as SafeAreaContextProvider,
  SafeAreaView as SafeAreaContextView
} from "react-native-safe-area-context";

export const ActivityIndicator = RN.ActivityIndicator as unknown as React.ComponentType<RN.ActivityIndicatorProps>;
export const KeyboardAvoidingView = RN.KeyboardAvoidingView as unknown as React.ComponentType<RN.KeyboardAvoidingViewProps>;
export const Modal = RN.Modal as unknown as React.ComponentType<RN.ModalProps>;
export const Pressable = RN.Pressable as unknown as React.ComponentType<RN.PressableProps>;
export const SafeAreaProvider = SafeAreaContextProvider as unknown as React.ComponentType<RN.ViewProps>;
export const SafeAreaView = SafeAreaContextView as unknown as React.ComponentType<RN.ViewProps>;
export const ScrollView = RN.ScrollView as unknown as React.ComponentType<RN.ScrollViewProps>;
export const StatusBar = RN.StatusBar as unknown as React.ComponentType<RN.StatusBarProps>;
export const Text = RN.Text as unknown as React.ComponentType<RN.TextProps>;
export const TextInput = RN.TextInput as unknown as React.ComponentType<RN.TextInputProps>;
export const TouchableOpacity = RN.TouchableOpacity as unknown as React.ComponentType<RN.TouchableOpacityProps>;
export const View = RN.View as unknown as React.ComponentType<RN.ViewProps>;

export const Alert = RN.Alert;
export const Platform = RN.Platform;
export const StyleSheet = RN.StyleSheet;
export const useWindowDimensions = RN.useWindowDimensions;

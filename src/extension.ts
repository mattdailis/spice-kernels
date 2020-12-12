import * as vscode from 'vscode';
import { BinaryKernelEditorProvider } from './binaryKernelEditor';

export function activate(context: vscode.ExtensionContext) {
    // Register our custom editor providers
	context.subscriptions.push(BinaryKernelEditorProvider.register(context));
}

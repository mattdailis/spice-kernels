import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import { getNonce } from './util';

interface BinaryKernelDocumentDelegate {
	getFileData(): Promise<Uint8Array>;
}

/**
 * Define the document (the data model) used for paw draw files.
 */
class BinaryKernelDocument extends Disposable implements vscode.CustomDocument {

static async create(
		uri: vscode.Uri,
		backupId: string | undefined,
		delegate: BinaryKernelDocumentDelegate,
	): Promise<BinaryKernelDocument | PromiseLike<BinaryKernelDocument>> {
		// If we have a backup, read that. Otherwise read the resource from the workspace
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
		const fileData = await BinaryKernelDocument.readFile(dataFile);
		return new BinaryKernelDocument(uri, fileData, delegate);
	}

	private static async readFile(uri: vscode.Uri): Promise<string[]> {
		function bin2String(array: number[]) {
			return String.fromCharCode.apply(String, array)
		}
		const bytes = vscode.workspace.fs.readFile(uri);
		const b = Array.from(await bytes)
		const lines = []
		const header = b.slice(0, 8).filter(n => n >= 32 && n <= 126);
		lines.push(bin2String(header))
		lines.push("")
		var currentLine = ""
		var runOfZeros = 0
		for (var byte of b.slice(1024, b.length)) {
			if (byte === 0) {
				if (runOfZeros < 2) {
					lines.push(currentLine)
					currentLine = ""
				}
				runOfZeros += 1
				continue
			}
			runOfZeros = 0
			const nextChar = String.fromCharCode(byte)
			if (!(byte >= 32 && byte <= 126)) {
				// If we encounter a non-ascii and non-zero byte, this is the End of Comment Section
				break
			}
			currentLine += nextChar
		}
		lines.push(currentLine)
		return lines;
	}

	private readonly _uri: vscode.Uri;

	private _documentData: string[];

	private readonly _delegate: BinaryKernelDocumentDelegate;

	private constructor(
		uri: vscode.Uri,
		initialContent: string[],
		delegate: BinaryKernelDocumentDelegate
	) {
		super();
		this._uri = uri;
		this._documentData = initialContent;
		this._delegate = delegate;
	}

	public get uri() { return this._uri; }

	public get documentData(): string[] { return this._documentData; }

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
	/**
	 * Fired when the document is disposed of.
	 */
	public readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChange = this._register(new vscode.EventEmitter<{
		readonly label: string,
		undo(): void,
		redo(): void,
	}>());
	/**
	 * Fired to tell VS Code that an edit has occured in the document.
	 * 
	 * This updates the document's dirty indicator.
	 */
	public readonly onDidChange = this._onDidChange.event;

	/**
	 * Called by VS Code when there are no more references to the document.
	 * 
	 * This happens when all editors for it have been closed.
	 */
	dispose(): void {
		this._onDidDispose.fire();
		super.dispose();
	}
}

/**
 * Provider for paw draw editors.
 * 
 * Paw draw editors are used for `.pawDraw` files, which are just `.png` files with a different file extension.
 * 
 * This provider demonstrates:
 * 
 * - How to implement a custom editor for binary files.
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Communication between VS Code and the custom editor.
 * - Using CustomDocuments to store information that is shared between multiple custom editors.
 * - Implementing save, undo, redo, and revert.
 * - Backing up a custom editor.
 */
export class BinaryKernelEditorProvider implements vscode.CustomReadonlyEditorProvider<BinaryKernelDocument> {
	// private static newPawDrawFileId = 1;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		// vscode.commands.registerCommand('spice-kernels.binaryKernel.new', () => {
		// 	const workspaceFolders = vscode.workspace.workspaceFolders;
		// 	if (!workspaceFolders) {
		// 		vscode.window.showErrorMessage("Creating new Paw Draw files currently requires opening a workspace");
		// 		return;
		// 	}

		// 	const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, `new-${BinaryKernelEditorProvider.newPawDrawFileId++}.pawdraw`)
		// 		.with({ scheme: 'untitled' });

		// 	vscode.commands.executeCommand('vscode.openWith', uri, BinaryKernelEditorProvider.viewType);
		// });

		return vscode.window.registerCustomEditorProvider(
			BinaryKernelEditorProvider.viewType,
			new BinaryKernelEditorProvider(context),
			{
				// For this demo extension, we enable `retainContextWhenHidden` which keeps the 
				// webview alive even when it is not visible. You should avoid using this setting
				// unless is absolutely required as it does have memory overhead.
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			});
	}

	private static readonly viewType = 'spice-kernels.binaryKernel';

	// /**
	//  * Tracks all known webviews
	//  */
	private readonly webviews = new WebviewCollection();

	constructor(
		private readonly _context: vscode.ExtensionContext
	) { }

	// //#region CustomEditorProvider

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string },
		_token: vscode.CancellationToken
	): Promise<BinaryKernelDocument> {
		const document: BinaryKernelDocument = await BinaryKernelDocument.create(uri, openContext.backupId, {
			getFileData: async () => {
				const webviewsForDocument = Array.from(this.webviews.get(document.uri));
				if (!webviewsForDocument.length) {
					throw new Error('Could not find webview to save for');
				}
				const panel = webviewsForDocument[0];
				const response = await this.postMessageWithResponse<number[]>(panel, 'getFileData', {});
				return new Uint8Array(response);
			}
		});

		const listeners: vscode.Disposable[] = [];

		document.onDidDispose(() => disposeAll(listeners));

		return document;
	}

	async resolveCustomEditor(
		document: BinaryKernelDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Add the webview to our internal set of active webviews
		this.webviews.add(document.uri, webviewPanel);

		// Setup initial content for the webview
		// webviewPanel.webview.options = {
		// 	enableScripts: true,
		// };
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.documentData);

		// webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

		// // Wait for the webview to be properly ready before we init
		// webviewPanel.webview.onDidReceiveMessage(e => {
		// 	if (e.type === 'ready') {
		// 		if (document.uri.scheme === 'untitled') {
		// 			this.postMessage(webviewPanel, 'init', {
		// 				untitled: true
		// 			});
		// 		} else {
		// 			this.postMessage(webviewPanel, 'init', {
		// 				value: document.documentData
		// 			});
		// 		}
		// 	}
		// });
	}

	/**
	 * Get the static HTML used for in our editor's webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview, lines: string[]): string {//w(webview: vscode.Webview): string {
		return /* html */`<!DOCTYPE html>
			<html lang="en">
			<head>
				<title>BSP</title>
				<style>
					code {
						color: var(--vscode-editor-foreground);
						font-family: var(--vscode-editor-font-family);
						font-size: var(--vscode-editor-font-size);
					}
				</style>
			</head>
			<body>
				<code>
					${lines.join("<br />")}
				</code>
			</body>
			</html>`;
	}

	private _requestId = 1;
	private readonly _callbacks = new Map<number, (response: any) => void>();

	private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
		const requestId = this._requestId++;
		const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
		panel.webview.postMessage({ type, requestId, body });
		return p;
	}

	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}

	private onMessage(document: BinaryKernelDocument, message: any) {
		switch (message.type) {
			case 'response':
				{
					const callback = this._callbacks.get(message.requestId);
					callback?.(message.body);
					return;
				}
		}
	}
}

/**
 * Tracks all webviews.
 */
class WebviewCollection {

	private readonly _webviews = new Set<{
		readonly resource: string;
		readonly webviewPanel: vscode.WebviewPanel;
	}>();

	/**
	 * Get all known webviews for a given uri.
	 */
	public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
		const key = uri.toString();
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				yield entry.webviewPanel;
			}
		}
	}

	/**
	 * Add a new webview to the collection.
	 */
	public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
		const entry = { resource: uri.toString(), webviewPanel };
		this._webviews.add(entry);

		webviewPanel.onDidDispose(() => {
			this._webviews.delete(entry);
		});
	}
}
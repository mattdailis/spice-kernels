"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryKernelEditorProvider = void 0;
const path = require("path");
const vscode = require("vscode");
const dispose_1 = require("./dispose");
const util_1 = require("./util");
/**
 * Define the document (the data model) used for paw draw files.
 */
class BinaryKernelDocument extends dispose_1.Disposable {
    constructor(uri, initialContent, delegate) {
        super();
        this._onDidDispose = this._register(new vscode.EventEmitter());
        /**
         * Fired when the document is disposed of.
         */
        this.onDidDispose = this._onDidDispose.event;
        this._onDidChange = this._register(new vscode.EventEmitter());
        /**
         * Fired to tell VS Code that an edit has occured in the document.
         *
         * This updates the document's dirty indicator.
         */
        this.onDidChange = this._onDidChange.event;
        this._uri = uri;
        this._documentData = initialContent;
        this._delegate = delegate;
    }
    static async create(uri, backupId, delegate) {
        // If we have a backup, read that. Otherwise read the resource from the workspace
        const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
        const fileData = await BinaryKernelDocument.readFile(dataFile);
        return new BinaryKernelDocument(uri, fileData, delegate);
    }
    static async readFile(uri) {
        if (uri.scheme === 'untitled') {
            return new Uint8Array();
        }
        return vscode.workspace.fs.readFile(uri);
    }
    get uri() { return this._uri; }
    get documentData() { return this._documentData; }
    /**
     * Called by VS Code when there are no more references to the document.
     *
     * This happens when all editors for it have been closed.
     */
    dispose() {
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
class BinaryKernelEditorProvider {
    constructor(_context) {
        this._context = _context;
        // /**
        //  * Tracks all known webviews
        //  */
        this.webviews = new WebviewCollection();
        this._requestId = 1;
        this._callbacks = new Map();
    }
    // private static newPawDrawFileId = 1;
    static register(context) {
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
        return vscode.window.registerCustomEditorProvider(BinaryKernelEditorProvider.viewType, new BinaryKernelEditorProvider(context), {
            // For this demo extension, we enable `retainContextWhenHidden` which keeps the 
            // webview alive even when it is not visible. You should avoid using this setting
            // unless is absolutely required as it does have memory overhead.
            webviewOptions: {
                retainContextWhenHidden: true,
            },
            supportsMultipleEditorsPerDocument: false,
        });
    }
    // //#region CustomEditorProvider
    async openCustomDocument(uri, openContext, _token) {
        const document = await BinaryKernelDocument.create(uri, openContext.backupId, {
            getFileData: async () => {
                const webviewsForDocument = Array.from(this.webviews.get(document.uri));
                if (!webviewsForDocument.length) {
                    throw new Error('Could not find webview to save for');
                }
                const panel = webviewsForDocument[0];
                const response = await this.postMessageWithResponse(panel, 'getFileData', {});
                return new Uint8Array(response);
            }
        });
        const listeners = [];
        document.onDidDispose(() => dispose_1.disposeAll(listeners));
        return document;
    }
    async resolveCustomEditor(document, webviewPanel, _token) {
        // Add the webview to our internal set of active webviews
        this.webviews.add(document.uri, webviewPanel);
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));
        // Wait for the webview to be properly ready before we init
        webviewPanel.webview.onDidReceiveMessage(e => {
            if (e.type === 'ready') {
                if (document.uri.scheme === 'untitled') {
                    this.postMessage(webviewPanel, 'init', {
                        untitled: true
                    });
                }
                else {
                    this.postMessage(webviewPanel, 'init', {
                        value: document.documentData
                    });
                }
            }
        });
    }
    // private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinaryKernelDocument>>();
    // public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
    // // public saveCustomDocument(document: BinaryKernelDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    // // 	return document.save(cancellation);
    // // }
    // // public saveCustomDocumentAs(document: PawDrawDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
    // // 	return document.saveAs(destination, cancellation);
    // // }
    // // public revertCustomDocument(document: PawDrawDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    // // 	return document.revert(cancellation);
    // // }
    // // public backupCustomDocument(document: PawDrawDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
    // // 	return document.backup(context.destination, cancellation);
    // // }
    // //#endregion
    /**
     * Get the static HTML used for in our editor's webviews.
     */
    getHtmlForWebview(webview) {
        // Local path to script and css for the webview
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, 'media', 'pawDraw.js')));
        const styleResetUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, 'media', 'reset.css')));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, 'media', 'vscode.css')));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, 'media', 'pawDraw.css')));
        // Use a nonce to whitelist which scripts can be run
        const nonce = util_1.getNonce();
        return "Hello world"; // /* html */`
        // <!DOCTYPE html>
        // <html lang="en">
        // <head>
        // 	<meta charset="UTF-8">
        // 	<!--
        // 	Use a content security policy to only allow loading images from https or from our extension directory,
        // 	and only allow scripts that have a specific nonce.
        // 	-->
        // 	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        // 	<meta name="viewport" content="width=device-width, initial-scale=1.0">
        // 	<link href="${styleResetUri}" rel="stylesheet" />
        // 	<link href="${styleVSCodeUri}" rel="stylesheet" />
        // 	<link href="${styleMainUri}" rel="stylesheet" />
        // 	<title>Paw Draw</title>
        // </head>
        // <body>
        // 	<div class="drawing-canvas"></div>
        // 	<div class="drawing-controls">
        // 		<button data-color="black" class="black active" title="Black"></button>
        // 		<button data-color="white" class="white" title="White"></button>
        // 		<button data-color="red" class="red" title="Red"></button>
        // 		<button data-color="green" class="green" title="Green"></button>
        // 		<button data-color="blue" class="blue" title="Blue"></button>
        // 	</div>
        // 	Hello world
        // 	<script nonce="${nonce}" src="${scriptUri}"></script>
        // </body>
        // </html>`;
    }
    postMessageWithResponse(panel, type, body) {
        const requestId = this._requestId++;
        const p = new Promise(resolve => this._callbacks.set(requestId, resolve));
        panel.webview.postMessage({ type, requestId, body });
        return p;
    }
    postMessage(panel, type, body) {
        panel.webview.postMessage({ type, body });
    }
    onMessage(document, message) {
        switch (message.type) {
            case 'response':
                {
                    const callback = this._callbacks.get(message.requestId);
                    callback === null || callback === void 0 ? void 0 : callback(message.body);
                    return;
                }
        }
    }
}
exports.BinaryKernelEditorProvider = BinaryKernelEditorProvider;
BinaryKernelEditorProvider.viewType = 'spice-kernels.binaryKernel';
/**
 * Tracks all webviews.
 */
class WebviewCollection {
    constructor() {
        this._webviews = new Set();
    }
    /**
     * Get all known webviews for a given uri.
     */
    *get(uri) {
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
    add(uri, webviewPanel) {
        const entry = { resource: uri.toString(), webviewPanel };
        this._webviews.add(entry);
        webviewPanel.onDidDispose(() => {
            this._webviews.delete(entry);
        });
    }
}
//# sourceMappingURL=binaryKernelEditor.js.map
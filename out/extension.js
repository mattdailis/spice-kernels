"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
const binaryKernelEditor_1 = require("./binaryKernelEditor");
function activate(context) {
    // Register our custom editor providers
    context.subscriptions.push(binaryKernelEditor_1.BinaryKernelEditorProvider.register(context));
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map
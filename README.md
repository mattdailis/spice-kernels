# spice-kernels README

This extension provides basic syntax highlighting for spice text kernels.

## Features

Syntax coloring helps distinguish between documentation and data. Without syntax highlighting, it would
be difficult to distinguish between the old data and the actual data in the example below:

![syntax coloring](./screenshot.png)

## Known Issues

If for some reason a file has a begindata with no matching begintext, that
syntax will not be colored. That is, however, quite uncommon.

## Release Notes

### 0.0.1

Initial release of spice-kernels

### 0.0.2

Trying to get images to show up in the marketplace.

### 0.0.3

Add logo

### 0.0.4

Add support for comment sections of .bsp, .bds, and .bc files

### 0.0.5

Bugfix for handling repeated zeros in file.

### 0.0.6

Use the default text editor font

### 0.0.7

Use inline css because I'm having trouble getting external css to work
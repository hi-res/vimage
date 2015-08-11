# Vimage

[![experimental](http://badges.github.io/stability-badges/dist/experimental.svg)](http://github.com/badges/stability-badges)

An image sequence streaming player for inline video on mobile devices.

This project was created as a workaround to provide inline video playback on mobile devices.


Demos:

* [Standard image sequence](http://hi-res.github.io/vimage/examples/sequence.html)
* [Video playback with audio](http://hi-res.github.io/vimage/examples/video.html)
* [VR (google cardboard)](http://hi-res.github.io/vimage/examples/vr.html)

## Features

* Minimal requests with [Magipack](https://github.com/keitakun/Magipack.js)
* Video and Audio playback with external library support

## Use cases

Use this library when inline video functionality is needed on mobiles or when you need an easily customizable image sequence player.

## Dependencies

Generating vimages

* ImageMagick
* ffmpeg

Lib

* [happens](https://github.com/arboleya/happens)
* [Magipack](https://github.com/keitakun/Magipack.js)

# Installation

```
# Install node and bower dependancies
make setup

# Install dependancies for converting the video to images
brew update && brew upgrade && brew install imagemagick
brew install ffmpeg --with-fdk-aac --with-ffplay --with-freetype --with-frei0r --with-libass --with-libvo-aacenc --with-libvorbis --with-libvpx --with-opencore-amr --with-openjpeg --with-opus --with-rtmpdump --with-schroedinger --with-speex --with-theora --with-tools
```

*Forgive my lack of creativity for the project name, I may change it to something else.*
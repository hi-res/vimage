happens 	   = require 'happens'
Utils 	 	   = require './utils'
SequenceLoader = require './loader'
SequencePlayer = require './player'

module.exports = window.Vimage = class Vimage

	constructor: ( options = {} ) ->

		happens @

		@options =
			'element': null
			'autoplay': true
			'fullscreen': false
			'buffer_percent': 0.1
			'type': 'video' # video or sequence

		Utils.merge @options, options

		@options.element = document.getElementById @options.element

		@player = new SequencePlayer @options.element

		# Modes
		@modes = (require './modes')

		# Loader
		@loader = new SequenceLoader

	load: ( file ) -> 

		@loader.on   'buffer:update',   @update_buffer
		@loader.once 'buffer:complete', @buffer_complete
		@loader.once 'data:loaded',     @data_loaded

		@loader.load file

	set_mode: ( @mode ) ->

		@player.set_mode @mode

	data_loaded: =>

		# c.log @loader

		@player.frame_width  = @loader.data.width
		@player.frame_height = @loader.data.height
		
		@player.set_size @loader.data.width, @loader.data.height

		if @options.fullscreen
			@player.enable_fullscreen_resize()

		###
		Play the mode after the first packs have loaded
		###

		@mode.total_frames = @loader.data.total_frames


	###
	Update the images buffer
	###
	update_buffer: ( images ) =>

		@player.update_buffer images

		if @options.type is 'video'

			if @mode.playing is off and @options.autoplay and @loader.percent_loaded >= @options.buffer_percent
				@mode.play @loader.data.duration

			if @mode.pause
				do @mode.resume
	
	###
	After all the packs have loaded
	###
	buffer_complete: =>

		@loader.off 'loaded'

		@loader.off 'buffer:update',   @update_buffer

		if @options.type is 'video'

			if @mode.playing is off and @options.autoplay and @loader.percent_loaded >= @options.buffer_percent
				@mode.play @loader.data.duration

		@emit 'loaded'

	play: -> do @mode.play
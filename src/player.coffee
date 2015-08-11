module.exports = class SequencePlayer

	# Current playback mode
	mode: null

	# Current frame of sequence
	current_frame: null

	frame_width: 0
	frame_height: 0

	constructor: ( @el ) ->

		###
		Create frame
		###

		@image = document.createElement 'img'
		@el.appendChild @image

		# Store the loaded images in this buffer
		@buffer = []


	###
	Update the images buffer
	###
	update_buffer: ( images ) ->

		@buffer = @buffer.concat images

		# c.log @buffer


	###
	Set the size of the player
	###
	set_size: (@width, @height) =>

		@el.style.width  = "#{@width}px"
		@el.style.height = "#{@height}px"

		Util.resize @image, @frame_width, @frame_height, @width, @height


	set_mode: ( mode ) ->

		# Unset previous events
		@mode?.off 'update', @update
		
		@mode = mode

		# Subscribe to new mode tick
		@mode.on 'update', @update


	update: => 
		
		# Return if mode isn't defined
		return unless @mode?

		# Get the current frame
		frame = @mode.get_frame()

		if frame isnt @current_frame

			@current_frame = frame

			image = @buffer[ @current_frame ]

			unless image?
				do @mode.pause
			else
				@image.setAttribute 'src', image.src

	get_current_frame_image: -> @buffer[ @current_frame ]

	###
	Enable the automatic resizing of the sequencer container on window resize
	###
	enable_fullscreen_resize: ->
		
		window.addEventListener 'resize', @fullscreen_resize
		
		do @fullscreen_resize

	###
	Disable the automatic resizing of the sequencer container on window resize
	###
	disable_fullscreen_resize: ->

		window.removeEventListener 'resize', @fullscreen_resize


	fullscreen_resize: =>
		@set_size window.innerWidth, window.innerHeight


Util = 

	calculate_resize: (image_width, image_height, win_width, win_height) ->

		window_ratio = win_width / win_height
		image_ratio1 = image_width / image_height
		image_ratio2 = image_height / image_width

		if window_ratio < image_ratio1
			
			new_height = win_height
			new_width  = Math.round( new_height * image_ratio1 )

			new_top  = 0
			new_left = (win_width * .5) - (new_width * .5) 

		else
			
			new_width  = win_width
			new_height = Math.round( new_width * image_ratio2 );

			new_top  = (win_height * .5) - (new_height * .5)
			new_left = 0 

		return {
			x      : new_left
			y      : new_top
			width  : new_width
			height : new_height
		}

	###
	Resize image(s) to the browser size retaining aspect ratio
	@param [jQuery]  $images
	@param [Number]  image_width
	@param [Number]  image_height
	@param [Number]  win_width
	@param [Number]  win_width
	@param [Boolean] backgroundsize
	###
	resize: (image, image_width, image_height, win_width, win_height) ->

		data = @calculate_resize image_width, image_height, win_width, win_height

		image.style.marginTop  = "#{data.y}px"
		image.style.marginLeft = "#{data.x}px"
		image.style.width 	   = "#{data.width}px"
		image.style.height 	   = "#{data.height}px"
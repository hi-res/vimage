happens = require 'happens'
c 		= require './log'

exports.PlaybackMode = class

	playing      : off
	paused       : off
	frame        : 0
	total_frames : 0
	duration 	 : 1
	percent 	 : 0
	loop 		 : off

	status: ''

	constructor: -> 

		happens @


	play: ( @duration ) ->

		params =
			frame: @total_frames
			ease: Linear.easeNone
			onStart: => 

				@playing = on
				
				@status = 'playing'

				@emit 'start'

			onUpdate: =>

				@percent = @frame / @total_frames

				@emit 'update'

			onComplete: =>
				
				# c.debug 'complete'

				@frame = 0
				if @loop
					@play( @duration ) 
				else
					@stop()

		@tween = TweenLite.to @, @duration, params

	###
	Pause the playback
	###
	pause: ->
		
		c.debug 'paused'

		@status = 'buffering'

		@paused = on
		do @tween.pause

		@emit 'pause'

	###
	Pause the playback
	###
	resume: ->

		return unless @playing
		return if @paused

		# c.debug 'resume'

		@status = 'playing'
		
		@paused = off
		do @tween?.play

		@emit 'resume'

	stop: ->

		@playing = off

		@status = 'stopped'

		@emit 'stop'

	get_frame: ->

		frame = Math.floor @frame
		frame = Math.min frame, @total_frames
		frame = Math.max frame, 0

		return frame

exports.FrameMode = class

	playing      : off
	paused       : off
	frame        : 0
	total_frames : 0
	duration 	 : 1
	percent 	 : 0

	status: ''

	constructor: -> 

		happens @

	set_frame: (@frame) ->

		@percent = @frame / @total_frames

	get_frame: -> @frame

	get_frame: ->

		frame = Math.floor @frame
		frame = Math.min frame, @total_frames
		frame = Math.max frame, 0

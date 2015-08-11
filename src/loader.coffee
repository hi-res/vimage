happens = require 'happens'
Loader  = require './loading/sync_loader'
c 		= require './log'

module.exports = class SequenceLoader

	path: ''
	packs_count: 0
	packs_total: 0
	percent_loaded: 0

	constructor: ( file ) ->

		happens @

		@loader = new Loader

		@loader.once 'loaded', @data_loaded

	load: ( file ) -> 

		# Get dir of pack files
		@path = file.split('/')
		@path.pop()
		@path = @path.join('/')

		@loader.add 'data', file, 'json'

		do @loader.load

	data_loaded: =>

		@data = (@loader.get_asset 'data').data

		@packs_total = @data.total_packs

		@emit 'data:loaded'

		@loader.on 'loaded', @packs_loaded

		do @_load


	_load: ->

		@loader.add "#{@packs_count}.pack", "#{@path}/#{@packs_count}.pack", 'binary'

		do @loader.load

	dispose: ->

		@loader.off 'loaded', @packs_loaded
		do @loader.dispose
		delete @loader
		@data = null

	packs_loaded: =>

		# c.log @loader

		# Create a new array for the latest loaded images
		images = []

		pack_id = "#{@packs_count}.pack"

		blob   = (@loader.get_asset "#{@packs_count}.pack").data
		config = @data['frames'][@packs_count]

		mp  = new Magipack(blob, config)
		len = config.length

		for i in [0...len]

			file_name = config[i][0]

			image  	  = new Image()
			image.src = mp.getURI file_name

			images.push image

		@emit 'buffer:update', images

		@packs_count++

		@percent_loaded = @packs_count / @packs_total

		c.debug "Loaded #{@packs_count} / #{@data.total_packs}"

		if @packs_count >= @packs_total
			@emit 'buffer:complete'
		else
			do @_load

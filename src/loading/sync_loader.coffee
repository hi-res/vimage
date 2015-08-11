AsyncLoader  = require './async_loader'
DataLoader   = require './data_loader'
BinaryLoader = require './binary_loader'
c 			 = require '../log'

###
Load files synchronously
###
module.exports = class SyncLoader extends AsyncLoader

	load: ->

		@date = new Date()

		@count = 0
		@total = @manifest.length

		if @manifest.length < 1
			@emit 'loaded'
		else
			do @_load


	_load: ->

		asset = @manifest[ @count ]

		switch asset.type

			when 'json', 'xml'
				l = new DataLoader
				l.once 'loaded', @success
				l.load asset

			when 'binary'
				l = new BinaryLoader
				l.once 'loaded', @success
				l.load asset

	success: ( asset ) =>

		@count++

		if @count >= @total
			# c.debug 'Loaded in', (new Date() - @date) / 1000
			@emit 'loaded', @manifest
		else
			do @_load
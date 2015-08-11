happens	 	 = require 'happens'
DataLoader   = require './data_loader'
BinaryLoader = require './binary_loader'
 
###
Load files asynchronously
###
module.exports = class AsyncLoader
 
	constructor: ->
 
		happens @
 
		@manifest = []
 
	add: (id, file, type, data) ->
 
		# c.log id, file, type
 
		obj =
			id   : id
			src  : file
			type : type
			data : data
 
		@manifest.push obj
 
	load: ->
 
		@count = 0
		@total = @manifest.length
 
		@date = new Date()
 
		for asset in @manifest
 
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
 
			c.debug 'Loaded in', (new Date() - @date) / 1000
 
			@emit 'loaded', @manifest
 
	error: ( error ) =>
 
		c.log 'error', error
 
 
	get_asset: ( id ) ->
		result = false
		for asset in @manifest
			if asset.id.match id
				result = asset
 
		return result

	dispose: ->

		@manifest = []
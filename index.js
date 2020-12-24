/*-----------------------------------------------------------------------------+
 |  Parallel XML2JSON converter                                Version 0.1.1   |
 |  Synthetic Semantics       http://www.synsem.com/       mogill@synsem.com   |
 +-----------------------------------------------------------------------------+
 |  Copyright (c) 2014, Synthetic Semantics LLC.  All rights reserved.         |
 |                                                                             |
 | Redistribution and use in source and binary forms, with or without          |
 | modification, are permitted provided that the following conditions are met: |
 |    * Redistributions of source code must retain the above copyright         |
 |      notice, this list of conditions and the following disclaimer.          |
 |    * Redistributions in binary form must reproduce the above copyright      |
 |      notice, this list of conditions and the following disclaimer in the    |
 |      documentation and/or other materials provided with the distribution.   |
 |    * Neither the name of the Synthetic Semantics nor the names of its       |
 |      contributors may be used to endorse or promote products derived        |
 |      from this software without specific prior written permission.          |
 |                                                                             |
 |    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS      |
 |    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT        |
 |    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR    |
 |    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL SYNTHETIC         |
 |    SEMANTICS LLC BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,   |
 |    EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,      |
 |    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR       |
 |    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF   |
 |    LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING     |
 |    NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS       |
 |    SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.             |
 |                                                                             |
 +-----------------------------------------------------------------------------*/

//-------------------------------------------------------------------
//  Module function export
//
module.exports = { 'parseAll': parXML2json };



//-------------------------------------------------------------------
//  Parse an XML file into an EMS JSON file
//
function parXML2json(ems, nProcsArg, xmlFilenameArg, emsFilenameArg, xmlTagArg, nTagsArg, maxBlockSizeArg, maxTagLengthArg) {
    //-------------------------------------------------------------------------------
    // Allocate EMS space for performance counters and return values
    //
    ems.parallel( function() {
        miscEMS = ems.new({
            dimensions: [ 100 ],
            heapSize: 100000,
            useMap: true,
            mlock: 99,
            persist: false,
            useExisting: false,
            setFEtags: 'full'
        });


        //-------------------------------------------------------------------------------
        //  Globally define utility functions
        //
        String.prototype.regexIndexOf = function (regex, startpos) {
            var indexOf = this.substring(startpos || 0).search(regex);
            return (indexOf >= 0) ? (indexOf + (startpos || 0)) : indexOf;
        };

        timerStart = function() { return new Date().getTime() };

        timerStop = function(timer, nOps, label, myID) {
            function fmtNumber(n) {
                var s = '                       ' +
                    n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                if (n < 1) return n;
                else {
                    return s.substr(s.length - 15, s.length)
                }
            }

            var now = new Date().getTime();
            var opsPerSec = (nOps * 1000000) / ((now - timer) * 1000);
            if (typeof myID === undefined || myID === 0) {
                console.log(fmtNumber(nOps) + label +
                    fmtNumber(Math.floor(opsPerSec).toString()) + " bytes/sec")
            }
        }
    });


    //-------------------------------------------------------------------
    // Only one thread initializes the miscEMS EMS region
    //
    miscEMS.writeXF('nRecords', 0);
    miscEMS.writeXF('nBytesParsed', 0);
    miscEMS.writeXF('args', {
        'nProcs'     : nProcsArg,
        'xmlFilename': xmlFilenameArg,
        'emsFilename': emsFilenameArg,
        'xmlTag': xmlTagArg,
        'nTags': nTagsArg,
        'maxBlockSize': maxBlockSizeArg,
        'maxTagLength': maxTagLengthArg
    });


    //-------------------------------------------------------------------
    //  Parse the XML file in parallel
    //
    //  Treat the file as a sequence of blocks which overlap by at least one XML record.
    //  If the end tag is found before the start tag
    //     Then: the text is discarded
    //     else: if the tag begins in the block (not the overlap)
    //              then: the entire tag will be parsed
    //              else: there are no tags in the block
    //
    ems.parallel(function () {
        //---------------------------------------------------------------------------------
        //  Function that performs the work of reading and parsing the file,
        //  executed once by every process.
        //
        function parseXML(ems, outputEMS, miscEMS, xmlFilename, maxBlockSize,
                          blockOverlap, xmlFileLength, xmlTag) {
            var fd = fs.openSync(xmlFilename, 'r');
            var buffer = Buffer.alloc(maxBlockSize + blockOverlap, 'utf8');
            var nBlocks = Math.floor(xmlFileLength / maxBlockSize) + 1;
            var xmlTagClose = '</' + xmlTag + '>\n';
            var tagRegExp = new RegExp('\<' + xmlTag + '[ \>]');
            var startTime = timerStart();
            ems.parForEach(0, nBlocks, function (blockN) {
                var index;
                var buflen = fs.readSync(fd, buffer, 0, maxBlockSize + blockOverlap, maxBlockSize * blockN);
                var XMLrecords = buffer.toString('utf8', 0, buflen).split(xmlTagClose);
                var recordN = 0;
                var nCharsParsed = 0;
                // Continue to parse XML records until the start of the record is in the next block
                while (recordN < XMLrecords.length - 1 && nCharsParsed < maxBlockSize) {
                    var releaseXMLStart = XMLrecords[recordN].regexIndexOf(tagRegExp);
                    if (releaseXMLStart < maxBlockSize) {
                        if (releaseXMLStart >= 0) {
                            // This is a complete XML record to parse
                            nCharsParsed += Buffer.byteLength(XMLrecords[recordN].substring(0, releaseXMLStart));
                            XMLrecords[recordN] = XMLrecords[recordN].substr(releaseXMLStart) + xmlTagClose;
                            xmlParser.parseString(XMLrecords[recordN], function (err, recordInJSON) {
                                if (recordInJSON === undefined || recordInJSON === null) {
                                    ems.diag('ERROR: blockN=' + blockN + '   recordN=' + recordN + '   undefined offset=' + nCharsParsed + '   XML=' + XMLrecords[recordN])
                                } else {
                                    // Get current and calculate the next index number, then
                                    // write JSON record to EMS.
                                    index = miscEMS.faa('nRecords', 1);
                                    outputEMS.writeXF(index, recordInJSON);
                                    nCharsParsed += Buffer.byteLength(XMLrecords[recordN]) + 0; // Plus newline
                                }
                            });
                        } else {
                            // Buffer starts in middle of XML record, do not parse
                            nCharsParsed += Buffer.byteLength(XMLrecords[recordN]) + xmlTagClose.length + 0; // </tag> + newline
                        }
                    }  // else there are no XML tags in this block, but there is one in the overlap
                    recordN++;
                }
                if(nCharsParsed < maxBlockSize  &&  blockN != nBlocks-1) {
                    console.log('Incomplete record -- increase block overlap/max tag length.  Currently=', blockOverlap);
                    process.exit(1);
                }
                miscEMS.faa('nBytesParsed', nCharsParsed);
                timerStop(startTime, miscEMS.readFF('nBytesParsed'), " chars (" + index + " records) parsed ", ems.myID);
            });
        }




        //---------------------------------------------------------------------------
        //  xvert() Entry point
        //
        var args = miscEMS.readFF('args');
        fs = require('fs');
        xml2js = require('xml2js');
        xmlParser = new xml2js.Parser();
        // ems.diag('im saying something anyway:' + xmlFilename);
        var stat = fs.statSync(args.xmlFilename);

        // Pick a blocksize that results in at least 3 blocks per process
        // Ensure the overlap is at least 4000 bytes but does not span more than 1 additional block
        args.maxBlockSize *= 2;
        do {
            args.maxBlockSize = Math.floor(args.maxBlockSize / 2) + 1;
            nBlocks = Math.floor(stat.size / args.maxBlockSize) + 1;
        } while (nBlocks < args.nProcs * 3);  //  TODO: Magic # of blocks per process
        var maxOverlap = Math.min(args.maxTagLength, args.maxBlockSize - 1); // TODO: Magic amount of overlap
        var blockOverlap = Math.min(Math.floor(args.maxBlockSize / 100) + 1, maxOverlap);

        // Construct the EMS descriptor to be used by future programs
        var minHeapSize = args.nTags * 200;  // TODO: malloc block size should not be hard-coded
        var outputDescr = {
            dimensions: [ args.nTags ],
            heapSize: Math.max(stat.size, minHeapSize),
            useMap: false,
            filename: args.emsFilename,
            persist: true,
            useExisting: true
        };
        if (ems.myID == 0)  miscEMS.writeXF('readEMSDescr', outputDescr);

        // Modify the EMS descriptor to create the EMS file
        outputDescr.mlock = 1;
        outputDescr.useExisting = false;
        outputDescr.doDataFill = true;
        outputDescr.dataFill = undefined;
        outputDescr.setFEtags = 'full';
        XML2jsonEMS = ems.new(outputDescr);

        // Wait until all threads have completed initialization
        ems.barrier();
        parseXML(ems, XML2jsonEMS, miscEMS, args.xmlFilename, args.maxBlockSize, blockOverlap, stat.size, args.xmlTag);
    });

    return {
        'outputEMS' : XML2jsonEMS,
        readEMSDescr : miscEMS.readFF('readEMSDescr'),
        nRecords: miscEMS.readFF('nRecords'),
        nBytesParsed: miscEMS.readFF('nBytesParsed')
    }

}

# Parallel XML to JSON Converter

This Javascript module converts 
large XML files to JSON in parallel by extracting 
all the elements with a given tag
and storing them in EMS shared & persistent storage.

Additional processing may be done with legacy sequential Node.js scripts,
to which additional [EMS](https://github.com/SyntheticSemantics/ems)-based 
parallelism can be added as needed.


## Why Parallel Processing for XML? 
Processing multi-gigabyte XML files suffers the dual challenges
 of slow serial processing and too large a memory footprint
 for garbage collected languages.
[EMS](https://github.com/SyntheticSemantics/ems) directly addresses both problems
with parallel programming primitives and a unified API for 
 synchronizing access to shared data.

Shared-nothing parallel programming models like Hadoop are not
applicable to processing a single XML file, and serial execution
under-utilizes expensive disk bandwidth.  This parallel XML
parser benefits from harnessing both the computing capability of multiple
cores and parallelism to mask file system latency.


### What This Package Does

The EMS memory region size is conservatively guesstimated on the XML file size, 
and may be as much as double the size of the XML file.
The following steps are carried out by every process:
 
1. Open the XML file and attach to the shared EMS memory
1. Read a block of the file at an offset based on the current shared loop index
1. All the tags in the block are identified
1. The [xml2js](https://www.npmjs.org/package/xml2js) NPM package parses the XML into JSON
1. The JSON value is stored in the EMS array

When no XML records remain, a join is performed and the original
function call returns.  The program may continue to process data or
immediately exit, in both cases 
the operating system flushes the EMS memory to the file at some later time.


__It is important to node that the converter does not 
maintain document ordering of the XML elements__, 
many users expect the document ordering
although this is not actually required in `XML 1.0`.
To restore original input order it is possible to sort the 
JSON records,
please contact us if you're interested in that capability.


  
## Single-Function API / Example Program
```
var nProcs = parseInt(process.argv[2]);
var xmlFilename = process.argv[3];
var parXML2json = require('./parXML2json');
var ems = require('ems')(nProcs, true, 'fj');

var emsParams = parXML2json.parseAll(
    ems,                                  // Global EMS object
    nProcs,                               // Number of processes
    xmlFilename,                          // XML input Filename
    xmlFilename.replace('.xml', '.ems'),  // EMS output filename
    process.argv[4],             // XML tag to create JSON object for
    process.argv[5],    // Maximum number of XML tag-data objects
    30000000,           // Largest filesystem read operation (in bytes)
    10000);             // Length of longest possible XML tag-data object

// Ordinary sequential loop to iterate through some of the JSON records.
// All work is performed using only the master thread.
for(var idx = 0;  idx < emsParams.nRecords;  idx += Math.floor(emsParams.nRecords/3) ) {
    //console.log('serial readback: ', idx, emsParams.outputEMS.readFF(idx) )
    console.log('serial readback: ', idx, XML2jsonEMS.readFF(idx) )
}

//  An EMS fork-join parallel region performs this function
//  once on every EMS worker process
ems.parallel( function() {
    //  Parallel loop, iterations are distributed across tasks.
    //  Static loop scheduling is used only to demonstrate each thread
    //  having one iteration.
    ems.parForEach(0, ems.nThreads, function (idx) {
        console.log('parallel readback', idx, XML2jsonEMS.readFF(idx));
    });
});

process.exit(0);  // Required to terminate other EMS processes
```

The return value of `parXML2json.parseAll()` is an object:
```
{ 
   outputEMS : <object>,     // EMS object used to access JSON data
   readEMSDescr : <object>,  // EMS descriptor to be used as the argument to ems.new() by future programs
   nRecords : <integer>,     // JSON elements are stored at indexes 0...nRecords-1 
   nBytesParsed : <integer>  // Number of bytes inspected while parsing (will be greater than the file size) 
}
```

Upon return, every process has the global variable `XML2jsonEMS` defined with
an EMS object that may be used to access the JSON elements.  This is "exported"
because in the fork-join model the non-master threads do not have any other way
of returning data or having a side-effect.


## Future Work
* Accept a user defined function that generates an unique key from the XML
  record and storing the key-value pair in EMS. 
* Sort results into original file order.

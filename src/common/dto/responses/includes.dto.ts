export const applyIncludesToDto = (dto, includes):any => {
    const filteredDto = {};
    includes.forEach((field) => {
        if (dto[field]) {
            filteredDto[field] = dto[field];
        }
    });
    return filteredDto;
}
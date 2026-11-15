package com.fundaro.zodiac.taurus.service.mapper;

import com.fundaro.zodiac.taurus.domain.Instruments;
import com.fundaro.zodiac.taurus.service.dto.InstrumentsDTO;
import org.mapstruct.BeanMapping;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;
import org.mapstruct.NullValuePropertyMappingStrategy;

/**
 * Mapper for the entity {@link Instruments} and its DTO {@link InstrumentsDTO}.
 * <p>
 * The position in the ensemble is only read: the ensemble is saved as a whole, by its own service.
 */
@Mapper(componentModel = "spring")
public interface InstrumentsMapper extends EntityOpenSearchMapper<InstrumentsDTO, Instruments> {
    @Override
    @Mapping(target = "ensemblePosition", ignore = true)
    Instruments toEntity(InstrumentsDTO dto);

    @Override
    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "ensemblePosition", ignore = true)
    void partialUpdate(@MappingTarget Instruments entity, InstrumentsDTO dto);
}

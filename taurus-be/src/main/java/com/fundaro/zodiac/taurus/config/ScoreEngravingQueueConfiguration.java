package com.fundaro.zodiac.taurus.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.Declarables;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Queue of the engraving jobs of the writing editor, bound to the Taurus exchange. Messages are JSON
 * {@code {"tenant": "...", "jobId": 1}}; the job table remains the source of truth.
 */
@Configuration
public class ScoreEngravingQueueConfiguration {

    public static final String QUEUE = "score.engraving";

    @Bean
    public Declarables scoreEngravingDeclarables() {
        return new Declarables(
            DeadLetterQueueConfiguration.workQueue(QUEUE),
            new Binding(QUEUE, Binding.DestinationType.QUEUE, RabbitMQConfig.topicExchangeName, QUEUE, null)
        );
    }
}
